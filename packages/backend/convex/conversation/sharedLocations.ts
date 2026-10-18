import type { LocationAttachmentView } from "@jigswap/contracts";
import { makePostMessage, toMemberId, toThreadId } from "@jigswap/domain";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { isBlockedEitherWay } from "../social/blocks";
import { areMutualFollowers } from "../social/privacy";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { isLocationConfigured, openStreetMapUrl } from "./adapters/mapTiler";
import { systemClock } from "./adapters/systemClock";
import {
  deleteAttachmentBlobs,
  type LocationAttachment,
} from "./messageAttachments";
import { threadRowByAggregateId } from "./readModelHelpers";

// Shared locations (spec 2.4, R.5, R.6): the rules behind sendLocation, the map render
// (renderLocationMap) and the thread read model. One-shot, never live.
//
// DEFERRED APPEND, like photos: sendLocation stores the row ("pending") and schedules the map
// render; the location message is appended only once the render has SETTLED (ready or failed), by
// settleLocationMap, through the domain PostMessage use case with the sender as author. There is
// no screening. A pair blocked in between gets nothing: the row and its map are dropped.

/** The final preview: 600x300, exact at zoom 15 (street level), approximate at 12 (~1 km area). */
export const LOCATION_MAP_WIDTH = 600;
export const LOCATION_MAP_HEIGHT = 300;
export const EXACT_MAP_ZOOM = 15;
export const APPROXIMATE_MAP_ZOOM = 12;
/** The shaded radius of an approximate location: covers the ~1.1 km grid cell it was snapped to. */
export const APPROXIMATE_RADIUS_METRES = 800;

/** The picker's view: 600x360, re-rendered on every pan, zoom or tap. */
export const PICKER_MAP_WIDTH = 600;
export const PICKER_MAP_HEIGHT = 360;
/** Picker images are temporary: each blob is deleted this long after it was rendered. */
export const PICKER_MAP_TTL_MS = 10 * 60_000;

/**
 * A location whose render has not settled this long after sendLocation is settled as failed
 * (expireLocationRender): it is appended as a text card rather than never arriving.
 */
export const LOCATION_RENDER_TIMEOUT_MS = 10 * 60_000;

/** How long a GPS-mode picker view is remembered (locationGpsViews). */
export const GPS_VIEW_TTL_MS = 15 * 60_000;
/**
 * A "pin" this close to a remembered GPS view counts as the member's current location: ~100 m,
 * plus up to ~65 m for the 3-decimal rounding of the stored view centre.
 */
export const GPS_MATCH_RADIUS_METRES = 165;

const round3 = (value: number) => Math.round(value * 1e3) / 1e3;

/** Great-circle distance in metres. */
export const distanceMetres = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Remember a picker view the member rendered around their device position, rounded to 3
 * decimals (~110 m), for GPS_VIEW_TTL_MS (the deletion is scheduled here).
 */
export const recordGpsView = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  threadAggregateId: string,
  centre: { lat: number; lng: number },
): Promise<void> => {
  const viewId = await ctx.db.insert("locationGpsViews", {
    memberId,
    threadAggregateId,
    lat: round3(centre.lat),
    lng: round3(centre.lng),
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(
    GPS_VIEW_TTL_MS,
    internal.conversation.locationStore.deleteGpsView,
    { viewId },
  );
};

/**
 * Whether a point lies within GPS_MATCH_RADIUS_METRES of a GPS view this member rendered in this
 * thread during the last GPS_VIEW_TTL_MS.
 */
export const isNearRecentGpsView = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
  threadAggregateId: string,
  point: { lat: number; lng: number },
): Promise<boolean> => {
  const views = await ctx.db
    .query("locationGpsViews")
    .withIndex("by_member_thread", (q) =>
      q
        .eq("memberId", memberId)
        .eq("threadAggregateId", threadAggregateId)
        .gt("createdAt", Date.now() - GPS_VIEW_TTL_MS),
    )
    .collect();
  return views.some(
    (view) => distanceMetres(view, point) <= GPS_MATCH_RADIUS_METRES,
  );
};

/** Feature gate (spec R.6): no MapTiler key means no location sharing at all. */
export const assertLocationAvailable = (): void => {
  if (!isLocationConfigured(process.env)) {
    throw new ConvexError({
      code: "LocationUnavailable",
      message: "Locations can't be shared right now",
    });
  }
};

/** Whether the member follows, and is followed by, every other participant of the thread. */
export const isMutualWithOthers = async (
  ctx: QueryCtx,
  participants: readonly Id<"users">[],
  memberId: Id<"users">,
): Promise<boolean> => {
  const others = participants.filter((p) => p !== memberId);
  if (others.length === 0) return false;
  for (const other of others) {
    if (!(await areMutualFollowers(ctx, memberId, other))) return false;
  }
  return true;
};

/**
 * The location message's attachment for a participant (callers have already checked that the
 * reader is one): the shared coordinates, the stored preview's URL once rendered, and the OSM
 * link. Null for a missing or removed location.
 */
export const locationAttachmentViewOf = async (
  ctx: QueryCtx,
  attachmentId: Id<"messageAttachments">,
): Promise<LocationAttachmentView | null> => {
  const row = await ctx.db.get(attachmentId);
  if (
    row?.kind !== "location" ||
    row.removedAt !== undefined ||
    row.lat === undefined ||
    row.lng === undefined
  ) {
    return null;
  }
  const mapUrl =
    row.mapStatus === "ready" && row.mapFileId
      ? await ctx.storage.getUrl(row.mapFileId)
      : null;
  return {
    kind: "location",
    lat: row.lat,
    lng: row.lng,
    precision: row.precision,
    ...(row.label !== undefined && { label: row.label }),
    ...(mapUrl !== null && { mapUrl }),
    openUrl: openStreetMapUrl(row.lat, row.lng, row.precision),
  };
};

const isPairBlocked = async (
  ctx: QueryCtx,
  row: LocationAttachment,
): Promise<boolean> => {
  const thread = await threadRowByAggregateId(ctx, row.threadAggregateId);
  if (!thread) return false;
  for (const other of thread.participants) {
    if (
      other !== row.uploaderId &&
      (await isBlockedEitherWay(ctx, row.uploaderId, other))
    ) {
      return true;
    }
  }
  return false;
};

const dropLocation = async (ctx: MutationCtx, row: LocationAttachment) => {
  await deleteAttachmentBlobs(ctx, row);
  await ctx.db.delete(row._id);
};

/**
 * The render settled (`mapFileId` when it succeeded): record the map status and append the
 * location message, once. A row that is gone or already delivered only drops the new blob; a
 * blocked pair, or an append the domain refuses (the sender left the thread), drops the row and
 * its map: it will never be delivered.
 */
export const settleLocation = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
  mapFileId: Id<"_storage"> | undefined,
): Promise<void> => {
  const row = await ctx.db.get(attachmentId);
  if (row?.kind !== "location" || row.messageId !== undefined) {
    if (mapFileId) await ctx.storage.delete(mapFileId);
    return;
  }
  const settled: LocationAttachment = {
    ...row,
    mapStatus: mapFileId ? "ready" : "failed",
    mapFileId,
  };
  if (await isPairBlocked(ctx, row)) {
    await dropLocation(ctx, settled);
    return;
  }
  const post = makePostMessage({
    threads: convexThreadRepository(ctx),
    messageIds: messageIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });
  const result = await post({
    threadId: toThreadId(row.threadAggregateId),
    authorId: toMemberId(row.uploaderId as string),
    kind: "location",
    body: row.caption ?? "",
    attachmentRef: row._id as string,
  });
  if (result.isErr) {
    logEvent({
      event: "conversation.deliverLocation",
      outcome: "error",
      attachment_id: row._id,
      error_code: result.error.code,
    });
    await dropLocation(ctx, settled);
    return;
  }
  await ctx.db.patch(row._id, {
    mapStatus: settled.mapStatus,
    ...(mapFileId && { mapFileId }),
    messageId: result.value as string,
    updatedAt: Date.now(),
  });
};
