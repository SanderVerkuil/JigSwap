import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../../_generated/server";
import { needsRescreen } from "../../library/adapters/photoModeration";

// The database side of library/rescreenPhotos for the images that have no moderation row of
// their own, or may not: box art (puzzles.image, a proposal's changes.image; listed in
// boxArtUploads only since the listing existed) and completion photos that predate the
// completionImages sidecars. Copy photos and sidecar completion photos use their stores'
// listRescreenCandidates / applyRescreenVerdict.

/** One image to classify. `imageId` is its moderation row, null when it has none yet. */
export type RescreenCandidate = {
  imageId: string | null;
  fileId: Id<"_storage">;
  uploaderId: Id<"users">;
  /** The holder: the puzzle or proposal id (box art), or the completion's aggregate id. */
  ref: string;
};

const listingOf = (ctx: QueryCtx, storageId: Id<"_storage">) =>
  ctx.db
    .query("boxArtUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();

/**
 * One page of definitions ("boxArt") or proposals ("proposals") and the box art among them that
 * was never classified: no listing (legacy, attributed to the submitter or proposer), or a
 * listing that needsRescreen. The same blob is listed once per page.
 */
export const listBoxArtCandidates = internalQuery({
  args: {
    table: v.union(v.literal("boxArt"), v.literal("proposals")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { table, paginationOpts }) => {
    const holders: { ref: string; image?: string; uploaderId: Id<"users"> }[] =
      [];
    let page;
    if (table === "boxArt") {
      page = await ctx.db.query("puzzles").paginate(paginationOpts);
      for (const puzzle of page.page) {
        holders.push({
          ref: puzzle._id,
          image: puzzle.image,
          uploaderId: puzzle.submittedBy,
        });
      }
    } else {
      page = await ctx.db
        .query("puzzleChangeProposals")
        .paginate(paginationOpts);
      for (const proposal of page.page) {
        holders.push({
          ref: proposal._id,
          image: proposal.changes.image,
          uploaderId: proposal.proposedBy,
        });
      }
    }
    const candidates: RescreenCandidate[] = [];
    const seen = new Set<string>();
    for (const holder of holders) {
      const fileId =
        holder.image && ctx.db.system.normalizeId("_storage", holder.image);
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);
      const listing = await listingOf(ctx, fileId);
      if (listing && !needsRescreen(listing)) continue;
      candidates.push({
        imageId: listing?._id ?? null,
        fileId,
        uploaderId: listing?.uploaderId ?? holder.uploaderId,
        ref: holder.ref,
      });
    }
    return {
      scanned: page.page.length,
      candidates,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * One page of completions and their photos that have no completionImages sidecar: stored
 * before the sidecars existed, so never screened and served as legacy photos.
 */
export const listLegacyCompletionCandidates = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("completions").paginate(paginationOpts);
    const candidates: RescreenCandidate[] = [];
    for (const completion of page.page) {
      if (!completion.aggregateId) continue;
      for (const fileId of completion.photos ?? []) {
        const sidecar = await ctx.db
          .query("completionImages")
          .withIndex("by_file", (q) => q.eq("fileId", fileId))
          .first();
        if (sidecar) continue;
        candidates.push({
          imageId: null,
          fileId,
          uploaderId: completion.userId,
          ref: completion.aggregateId,
        });
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

/**
 * The completionImages sidecar for a legacy completion photo, created when missing (no status:
 * like any legacy row it stays served until a verdict or a quarantine says otherwise), so the
 * verdict and the quarantine step have a row to act on.
 */
export const ensureLegacyCompletionSidecar = internalMutation({
  args: {
    completionId: v.string(),
    fileId: v.id("_storage"),
    uploaderId: v.id("users"),
  },
  handler: async (ctx, { completionId, fileId, uploaderId }) => {
    const existing = await ctx.db
      .query("completionImages")
      .withIndex("by_file", (q) => q.eq("fileId", fileId))
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    return ctx.db.insert("completionImages", {
      completionId,
      uploaderId,
      fileId,
      createdAt: now,
      updatedAt: now,
    });
  },
});
