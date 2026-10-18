import type { LocationAttachmentView } from "@jigswap/contracts";
import { makePostMessage, toMemberId, toThreadId } from "@jigswap/domain";
import { ConvexError } from "convex/values";
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
