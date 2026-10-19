import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";

// The database side of the one-shot lib/imageModeration/backfillBoxArtHashCheck: which stored box
// art still needs a CSAM hash check, and its `boxArtUploads` listing (created for legacy box art
// that predates the listing, so the pipeline's quarantine step has a row to act on).

export const totalsValidator = v.object({
  scanned: v.number(),
  unchecked: v.number(),
  noMatch: v.number(),
  matched: v.number(),
  unavailable: v.number(),
  skipped: v.number(),
});
export type Totals = typeof totalsValidator.type;

export const ZERO: Totals = {
  scanned: 0,
  unchecked: 0,
  noMatch: 0,
  matched: 0,
  unavailable: 0,
  skipped: 0,
};

const listingOf = (ctx: QueryCtx, storageId: Id<"_storage">) =>
  ctx.db
    .query("boxArtUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();

/**
 * Whether the box art still needs a hash check, and whom it is attributed to: null when its
 * listing already passed one, or the live pipeline owns it (pending, quarantined). Legacy box
 * art without a listing is attributed to the definition's submitter or the proposer.
 */
export const candidate = internalQuery({
  args: {
    table: v.union(v.literal("boxArt"), v.literal("proposals")),
    id: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { table, id, storageId }) => {
    const listing = await listingOf(ctx, storageId);
    if (listing) {
      if (
        listing.hashCheckedAt !== undefined ||
        listing.moderationStatus === "pending" ||
        listing.moderationStatus === "quarantined" ||
        listing.moderationStatus === "rejected"
      ) {
        return null;
      }
      return { uploaderId: listing.uploaderId };
    }
    if (table === "boxArt") {
      const puzzleId = ctx.db.normalizeId("puzzles", id);
      const puzzle = puzzleId && (await ctx.db.get(puzzleId));
      return puzzle ? { uploaderId: puzzle.submittedBy } : null;
    }
    const proposalId = ctx.db.normalizeId("puzzleChangeProposals", id);
    const proposal = proposalId && (await ctx.db.get(proposalId));
    return proposal ? { uploaderId: proposal.proposedBy } : null;
  },
});

const ensureListing = async (
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  uploaderId: Id<"users">,
): Promise<Id<"boxArtUploads">> =>
  (await listingOf(ctx, storageId))?._id ??
  // No status: like every listing from before box art was moderated, it stays served unless a
  // match quarantines it.
  (await ctx.db.insert("boxArtUploads", {
    storageId,
    uploaderId,
    createdAt: Date.now(),
  }));

/** The listing the pipeline's quarantine step acts on (created for legacy box art). */
export const listingForQuarantine = internalMutation({
  args: { storageId: v.id("_storage"), uploaderId: v.id("users") },
  handler: (ctx, { storageId, uploaderId }) =>
    ensureListing(ctx, storageId, uploaderId),
});

/** Record a no_match, so a re-run skips this box art. */
export const markHashChecked = internalMutation({
  args: { storageId: v.id("_storage"), uploaderId: v.id("users") },
  handler: async (ctx, { storageId, uploaderId }) => {
    const rowId = await ensureListing(ctx, storageId, uploaderId);
    await ctx.db.patch(rowId, {
      hashCheckedAt: Date.now(),
      hashCheckPendingSince: undefined,
      pendingHashes: undefined,
    });
  },
});
