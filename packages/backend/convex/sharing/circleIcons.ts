import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import {
  renditionSources,
  thumbUrlOf,
} from "../lib/imageModeration/imageSources";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";
import {
  deleteRenditions,
  scheduleRenditions,
} from "../lib/imageModeration/renditionsStore";
import { isCircleAdmin } from "./circleAccess";

// A circle's icon: one per circle, shown everywhere the circle is (its card, its page, its group
// chat). Only the circle's Admins set, change or remove it (sharing/setCircleIcon,
// sharing/removeCircleIcon). Every upload is a `circleIcons` row on the shared image-moderation
// pipeline (sharing/moderateCircleIcon, store sharing/circleIconModerationStore): metadata strip
// and turned upright, the CSAM hash check, the content check, the Workpool's retries, the stalled
// sweep, the hash-check timeout and the admin queues, exactly as for every other photo.
//
// SERVED: only the newest row that is "approved" with its hash check passed, and only to the
// circle's current members (every read gates on membership before it asks for the URL). While a
// newer upload is being checked, or once it was refused, members keep seeing the previous icon,
// or the default when there was none. The uploader and the circle's Admins see "checking" while
// it is; the uploader sees "removed" once the check refused it (CSAM matches included: the same
// answer as refused content, lib/imageModeration/quarantine). An icon is only ever a small avatar,
// so `iconUrl` is its small rendition (lib/imageModeration/renditionsStore) once it has one, else
// the original.
//
// LIFECYCLE: once a row becomes servable, the older rows go (row, blob and rendition) and it gets
// its rendition in the background; a new upload drops every row but the current icon; remove drops
// them all; deleting the circle purges them (sharing/purgeDeletedCircle). A quarantined row is
// never dropped and a preserved blob never deleted (the escalation keeps them); a quarantine and
// a rejection delete the rendition.

/** The content types accepted for an icon (the pipeline checks the bytes themselves). */
export const CIRCLE_ICON_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];
/** The largest icon upload accepted. */
export const CIRCLE_ICON_MAX_BYTES = 10 * 1024 * 1024;
/** An upload must be claimed within this long of its creation. */
export const CIRCLE_ICON_CLAIM_WINDOW_MS = 15 * 60_000;

// Rows read per circle: the current icon, a newer upload in check, and kept quarantined rows.
const ICON_ROWS_READ = 20;

/** Whether an icon row may be shown to the circle's members. */
export const isCircleIconServable = (
  row: Pick<
    Doc<"circleIcons">,
    "moderationStatus" | "hashCheckedAt" | "hashCheckPendingSince"
  >,
): boolean => row.moderationStatus === "approved" && isHashCleared(row);

/** The circle's icon rows, newest first. */
export const circleIconRows = (
  ctx: QueryCtx,
  circleId: string,
): Promise<Doc<"circleIcons">[]> =>
  ctx.db
    .query("circleIcons")
    .withIndex("by_circle", (q) => q.eq("circleId", circleId))
    .order("desc")
    .take(ICON_ROWS_READ);

/** What a viewer is told about an upload that is not (yet) the icon. */
export type CircleIconStatus = "checking" | "removed";

/**
 * The icon fields of a circle for `viewerId`, who must be one of its current members (callers gate
 * on that first): the URL of the current icon, and the status of a newer upload where the viewer
 * may know about it.
 */
export const circleIconFields = async (
  ctx: QueryCtx,
  circle: Doc<"circles">,
  viewerId: Id<"users">,
): Promise<{ iconUrl?: string; iconStatus?: CircleIconStatus }> => {
  if (!circle.memberships.some((m) => m.memberId === viewerId)) return {};
  const rows = await circleIconRows(ctx, circle.aggregateId ?? circle._id);
  const current = rows.find(isCircleIconServable);
  const url = current ? await ctx.storage.getUrl(current.fileId) : null;
  const iconUrl =
    current && url
      ? thumbUrlOf(await renditionSources(ctx, current.fileId, url))
      : null;
  const newest = rows[0];
  let status: CircleIconStatus | undefined;
  if (newest && newest !== current) {
    const mine = newest.uploaderId === viewerId;
    if (
      newest.moderationStatus === "rejected" ||
      newest.moderationStatus === "quarantined"
    ) {
      if (mine && newest.noticeDismissedAt === undefined) status = "removed";
    } else if (mine || isCircleAdmin(circle, viewerId)) {
      status = "checking";
    }
  }
  return {
    ...(iconUrl ? { iconUrl } : {}),
    ...(status ? { iconStatus: status } : {}),
  };
};

/**
 * Drop an icon row with its blob and rendition. A quarantined row is kept whole for its escalation,
 * and a blob an escalation preserves is never deleted. Returns whether the row went.
 */
export const dropCircleIcon = async (
  ctx: MutationCtx,
  row: Doc<"circleIcons">,
): Promise<boolean> => {
  if (row.moderationStatus === "quarantined") return false;
  await ctx.db.delete(row._id);
  await deleteRenditions(ctx, row.fileId);
  if (!(await isPreservedBlob(ctx, row.fileId))) {
    try {
      await ctx.storage.delete(row.fileId);
    } catch {
      // Already gone (a rejected icon's blob is deleted with the verdict).
    }
  }
  return true;
};

/**
 * Once `iconId` may be served it is the circle's icon: the rows uploaded before it go, and it gets
 * its rendition. Called after every write that can open it (a verdict, a passed hash check, an
 * admin's decision).
 */
export const settleCircleIcon = async (
  ctx: MutationCtx,
  iconId: Id<"circleIcons">,
): Promise<void> => {
  const row = await ctx.db.get(iconId);
  if (!row || !isCircleIconServable(row)) return;
  for (const other of await circleIconRows(ctx, row.circleId)) {
    if (other._id !== row._id && other.createdAt <= row.createdAt) {
      await dropCircleIcon(ctx, other);
    }
  }
  await scheduleRenditions(ctx, row.fileId);
};

/** Drop every icon row of the circle (quarantined ones excepted). Returns how many went. */
export const dropCircleIcons = async (
  ctx: MutationCtx,
  circleId: string,
  limit: number = ICON_ROWS_READ,
): Promise<number> => {
  const rows = await ctx.db
    .query("circleIcons")
    .withIndex("by_circle", (q) => q.eq("circleId", circleId))
    .filter((q) => q.neq(q.field("moderationStatus"), "quarantined"))
    .take(limit);
  let dropped = 0;
  for (const row of rows) {
    if (await dropCircleIcon(ctx, row)) dropped += 1;
  }
  return dropped;
};
