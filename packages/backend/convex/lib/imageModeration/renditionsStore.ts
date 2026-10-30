import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { isReferenced } from "./blobReferences";
import { isPreservedBlob } from "./quarantine";

// The database side of image renditions (lib/imageModeration/renditions, a Node action, makes
// them): which blobs get renditions, recording them, and deleting them with their source.
//
// Invariants:
// - A rendition exists only for an ELIGIBLE source blob that is still stored (isRenditionSource,
//   checked again when recording): box art that may be shown, never one that is pending,
//   unscored, rejected, quarantined, preserved for an escalation, or not box art at all.
// - Every rendition blob counts as referenced (blobReferences.isReferenced), so no upload flow
//   can claim it and a storage sweep keeps it.
// - ANY code that deletes or quarantines a source image blob calls `deleteRenditions` for it, so
//   no rendition outlives its source.
// - Responses never carry a rendition's storage id: read models turn it into a URL, and only
//   behind the source's own publication gate (boxArtUrl for box art).

const slotValidator = v.object({
  fileId: v.id("_storage"),
  width: v.number(),
  height: v.number(),
});

/**
 * Whether the blob may get renditions: box art that may be shown. Its boxArtUploads row is
 * "approved" or from before box art was moderated (no status); with no row at all, a definition
 * holds it (box art from before the listing existed). Not a blob preserved for an escalation.
 * The hash check is not required: renditions are no more exposed than the stored source, and
 * read models serve them only through the source's gate (boxArtUrl).
 */
export const isRenditionSource = async (
  ctx: QueryCtx,
  sourceId: Id<"_storage">,
): Promise<boolean> => {
  if (await isPreservedBlob(ctx, sourceId)) return false;
  const listing = await ctx.db
    .query("boxArtUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", sourceId))
    .first();
  if (listing) return (listing.moderationStatus ?? "approved") === "approved";
  return (
    (await ctx.db
      .query("puzzles")
      .withIndex("by_image", (q) => q.eq("image", sourceId))
      .first()) !== null
  );
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

/** Whether the source may get renditions, and whether it already has them. */
export const renditionJob = internalQuery({
  args: { sourceId: v.id("_storage") },
  handler: async (ctx, { sourceId }) => ({
    eligible: await isRenditionSource(ctx, sourceId),
    done: (await renditionsRow(ctx, sourceId)) !== null,
  }),
});

/**
 * Record the renditions just stored for a source. Only when the source blob still exists, is
 * still eligible and has no renditions yet; otherwise the new blobs are deleted. Returns whether
 * they were recorded.
 */
export const recordRenditions = internalMutation({
  args: {
    sourceId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    small: v.optional(slotValidator),
    medium: v.optional(slotValidator),
  },
  handler: async (
    ctx,
    { sourceId, width, height, small, medium },
  ): Promise<boolean> => {
    const keep =
      (await ctx.db.system.get(sourceId)) !== null &&
      (await isRenditionSource(ctx, sourceId)) &&
      (await renditionsRow(ctx, sourceId)) === null;
    if (!keep) {
      for (const slot of [small, medium]) {
        if (slot) await deleteUnreferenced(ctx, slot.fileId);
      }
      return false;
    }
    await ctx.db.insert("imageRenditions", {
      sourceId,
      width,
      height,
      ...(small && { small }),
      ...(medium && { medium }),
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
    for (const slot of [row.small, row.medium]) {
      if (slot) await deleteUnreferenced(ctx, slot.fileId);
    }
  }
};
