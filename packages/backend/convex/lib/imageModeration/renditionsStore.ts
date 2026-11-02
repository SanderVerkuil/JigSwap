import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { isServable } from "../../conversation/messagePhotoGate";
import { isReferenced } from "./blobReferences";
import { isPreservedBlob } from "./quarantine";

// The database side of image renditions (lib/imageModeration/renditions, a Node action, makes
// them): which blobs get renditions, recording them, and deleting them with their source.
//
// Invariants:
// - A rendition exists only for an ELIGIBLE source blob that is still stored (renditionKindOf,
//   checked again when recording): box art, a copy or completion photo or a circle icon that may
//   be shown, or a message photo that may be served (isServable), never one that is pending,
//   unscored, rejected, quarantined, preserved for an escalation, or none of these at all.
// - A message photo's one thumbnail is held by its own row (messageAttachments.thumbFileId) rather
//   than in `imageRenditions`: every path that deletes the photo's blobs already takes it along
//   (conversation/messageAttachments.deleteAttachmentBlobs), and a quarantine deletes it at once.
// - Every rendition blob counts as referenced (blobReferences.isReferenced), so no upload flow
//   can claim it and a storage sweep keeps it.
// - ANY code that deletes or quarantines a source image blob calls `deleteRenditions` for it, so
//   no rendition outlives its source.
// - Responses never carry a rendition's storage id: read models turn it into a URL, and only
//   behind the source's own publication gate (boxArtUrl for box art; approved and hash-cleared
//   for a copy photo, library/resolveCoverUrl and getCopyInstanceView, a completion photo,
//   solving/listMyCompletions and social/listProfileCompletions, a circle icon for the circle's
//   members, sharing/circleIcons.circleIconFields, or a message photo per reader,
//   conversation/messageAttachments.messageAttachmentViews).

const slotValidator = v.object({
  fileId: v.id("_storage"),
  width: v.number(),
  height: v.number(),
});

/**
 * What the backfill covers: "boxArt" = every definition's `image`; "copy" = copy photos;
 * "completion" = completion photos (their sidecars; a legacy photo without one is left until
 * solving/backfillLegacyCompletionSidecars gives it one); "circleIcon" = circle icons; "message" =
 * message photos.
 */
export const renditionTableValidator = v.union(
  v.literal("boxArt"),
  v.literal("copy"),
  v.literal("completion"),
  v.literal("circleIcon"),
  v.literal("message"),
);

export const backfillTotalsValidator = v.object({
  // Rows read.
  scanned: v.number(),
  // Eligible sources without renditions yet (all a dry run counts).
  candidates: v.number(),
  // Recorded (a source none of whose renditions came out clearly smaller gets a row without
  // any).
  recorded: v.number(),
  // Bytes the input guards refused, or that did not decode.
  refused: v.number(),
  // Storage, database or encoder failures, or the source was deleted meanwhile; a re-run
  // tries them again.
  failed: v.number(),
  // No longer a candidate when its turn came (decided or recorded meanwhile).
  skipped: v.number(),
});
export type BackfillTotals = typeof backfillTotalsValidator.type;

export const NO_TOTALS: BackfillTotals = {
  scanned: 0,
  candidates: 0,
  recorded: 0,
  refused: 0,
  failed: 0,
  skipped: 0,
};

/** What a source blob is; the action picks the sizes to make from it. */
export type RenditionKind =
  "boxArt" | "copy" | "completion" | "circleIcon" | "message";

const whenApproved = <K extends RenditionKind>(
  kind: K,
  row: { moderationStatus?: string },
): K | null =>
  (row.moderationStatus ?? "approved") === "approved" ? kind : null;

// The message photo that holds the blob, if any.
const messagePhotoOf = async (ctx: QueryCtx, sourceId: Id<"_storage">) => {
  const row = await ctx.db
    .query("messageAttachments")
    .withIndex("by_file", (q) => q.eq("fileId", sourceId))
    .first();
  return row?.kind === "image" ? row : null;
};

/**
 * What the blob is when it may get renditions (an image that may be shown), else null. A copy or
 * completion photo whose row is "approved" or from before photos were moderated (no status). A
 * circle icon whose row is "approved". Box art whose boxArtUploads row is "approved" or from before
 * box art was moderated (no status); with no row at all, a definition holds it (box art from before
 * the listing existed). Not a blob preserved for an escalation. The hash check is not required:
 * renditions are no more exposed than the stored source, and read models serve them only through
 * the source's gate (boxArtUrl; a photo's or icon's approved and hash-cleared check). A message
 * photo is stricter: nothing is derived from it before it may be served (isServable, with the hash
 * check and the re-encode), nor from one hidden from its sender.
 */
export const renditionKindOf = async (
  ctx: QueryCtx,
  sourceId: Id<"_storage">,
): Promise<RenditionKind | null> => {
  if (await isPreservedBlob(ctx, sourceId)) return null;
  const photo = await ctx.db
    .query("ownedPuzzleImages")
    .withIndex("by_file", (q) => q.eq("fileId", sourceId))
    .first();
  if (photo) return whenApproved("copy", photo);
  const completionPhoto = await ctx.db
    .query("completionImages")
    .withIndex("by_file", (q) => q.eq("fileId", sourceId))
    .first();
  if (completionPhoto) return whenApproved("completion", completionPhoto);
  const icon = await ctx.db
    .query("circleIcons")
    .withIndex("by_file", (q) => q.eq("fileId", sourceId))
    .first();
  if (icon) return whenApproved("circleIcon", icon);
  const messagePhoto = await messagePhotoOf(ctx, sourceId);
  if (messagePhoto) {
    return isServable(messagePhoto) && !messagePhoto.hiddenFromSender
      ? "message"
      : null;
  }
  const listing = await ctx.db
    .query("boxArtUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", sourceId))
    .first();
  if (listing) return whenApproved("boxArt", listing);
  return (await ctx.db
    .query("puzzles")
    .withIndex("by_image", (q) => q.eq("image", sourceId))
    .first()) !== null
    ? "boxArt"
    : null;
};

const renditionsRow = (ctx: QueryCtx, sourceId: Id<"_storage">) =>
  ctx.db
    .query("imageRenditions")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .first();

// Delete a blob unless something (another rendition row, a photo, an escalation) references it.
const deleteUnreferenced = async (ctx: MutationCtx, fileId: Id<"_storage">) => {
  if (!(await ctx.db.system.get(fileId))) return;
  if (await isReferenced(ctx, fileId)) return;
  await ctx.storage.delete(fileId);
};

// Whether the source's renditions were made already, with or without a result to keep.
const renditionsDone = async (
  ctx: QueryCtx,
  sourceId: Id<"_storage">,
  kind: RenditionKind | null,
): Promise<boolean> => {
  if (kind !== "message") return (await renditionsRow(ctx, sourceId)) !== null;
  const photo = await messagePhotoOf(ctx, sourceId);
  return (
    photo?.thumbCheckedAt !== undefined || photo?.thumbFileId !== undefined
  );
};

/** What the source is when it may get renditions (else null), and whether it already has them. */
export const renditionJob = internalQuery({
  args: { sourceId: v.id("_storage") },
  handler: async (ctx, { sourceId }) => {
    const kind = await renditionKindOf(ctx, sourceId);
    return { kind, done: await renditionsDone(ctx, sourceId, kind) };
  },
});

/**
 * Record the renditions just stored for a source, on the message photo's row or in
 * `imageRenditions`. Only when the source blob still exists, is still eligible and has no
 * renditions yet; otherwise the new blobs are deleted. Returns whether they were recorded.
 */
export const recordRenditions = internalMutation({
  args: {
    sourceId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    small: v.optional(slotValidator),
    medium: v.optional(slotValidator),
    large: v.optional(slotValidator),
  },
  handler: async (
    ctx,
    { sourceId, width, height, small, medium, large },
  ): Promise<boolean> => {
    const kind =
      (await ctx.db.system.get(sourceId)) !== null
        ? await renditionKindOf(ctx, sourceId)
        : null;
    if (kind === null || (await renditionsDone(ctx, sourceId, kind))) {
      for (const slot of [small, medium, large]) {
        if (slot) await deleteUnreferenced(ctx, slot.fileId);
      }
      return false;
    }
    const photo = kind === "message" && (await messagePhotoOf(ctx, sourceId));
    if (photo) {
      await ctx.db.patch(photo._id, {
        ...(small && { thumbFileId: small.fileId }),
        thumbCheckedAt: Date.now(),
      });
      return true;
    }
    await ctx.db.insert("imageRenditions", {
      sourceId,
      width,
      height,
      ...(small && { small }),
      ...(medium && { medium }),
      ...(large && { large }),
      createdAt: Date.now(),
    });
    return true;
  },
});

/** Delete blobs stored for renditions that were never recorded (a failed run's cleanup). */
export const discardUnrecorded = internalMutation({
  args: { fileIds: v.array(v.id("_storage")) },
  handler: async (ctx, { fileIds }) => {
    for (const fileId of fileIds) await deleteUnreferenced(ctx, fileId);
  },
});

/** Make the source's renditions in the background (a no-op when it is not eligible). */
export const scheduleRenditions = async (
  ctx: MutationCtx,
  sourceId: Id<"_storage">,
): Promise<void> => {
  await ctx.scheduler.runAfter(
    0,
    internal.lib.imageModeration.renditions.generateRenditions,
    { sourceId },
  );
};

/**
 * Delete the source's renditions: the row and its blobs (one already gone is fine). Call it
 * wherever a source image blob is deleted or quarantined; the source itself is left alone.
 */
export const deleteRenditions = async (
  ctx: MutationCtx,
  sourceId: Id<"_storage">,
): Promise<void> => {
  const rows = await ctx.db
    .query("imageRenditions")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
    for (const slot of [row.small, row.medium, row.large]) {
      if (slot) await deleteUnreferenced(ctx, slot.fileId);
    }
  }
};

// One page of a backfill table: the rows read, and the source blob each names (if any).
const backfillPage = async (
  ctx: QueryCtx,
  table: typeof renditionTableValidator.type,
  paginationOpts: PaginationOptions,
) => {
  switch (table) {
    case "copy": {
      const page = await ctx.db
        .query("ownedPuzzleImages")
        .paginate(paginationOpts);
      return { ...page, sources: page.page.map((row) => row.fileId) };
    }
    case "completion": {
      const page = await ctx.db
        .query("completionImages")
        .paginate(paginationOpts);
      return { ...page, sources: page.page.map((row) => row.fileId) };
    }
    case "circleIcon": {
      const page = await ctx.db.query("circleIcons").paginate(paginationOpts);
      return { ...page, sources: page.page.map((row) => row.fileId) };
    }
    case "message": {
      const page = await ctx.db
        .query("messageAttachments")
        .paginate(paginationOpts);
      return {
        ...page,
        sources: page.page.map((row) =>
          row.kind === "image" ? row.fileId : undefined,
        ),
      };
    }
    case "boxArt": {
      const page = await ctx.db.query("puzzles").paginate(paginationOpts);
      return { ...page, sources: page.page.map((row) => row.image) };
    }
  }
};

/**
 * One page of the backfill (lib/imageModeration/renditions.backfillRenditions): the distinct
 * stored, eligible sources on the page (see renditionTableValidator) that have no renditions yet.
 */
export const listRenditionCandidates = internalQuery({
  args: {
    table: renditionTableValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { table, paginationOpts }) => {
    const page = await backfillPage(ctx, table, paginationOpts);
    const candidates: Id<"_storage">[] = [];
    for (const sourceId of page.sources) {
      if (!sourceId || candidates.includes(sourceId)) continue;
      if ((await ctx.db.system.get(sourceId)) === null) continue;
      const kind = await renditionKindOf(ctx, sourceId);
      if (kind !== null && !(await renditionsDone(ctx, sourceId, kind))) {
        candidates.push(sourceId);
      }
    }
    return {
      scanned: page.page.length,
      candidates,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
