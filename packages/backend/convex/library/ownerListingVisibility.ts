import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";
import { listingStateDiffers, listingStateOf } from "./openListing";

// Copies per batch: one read and at most one patch each.
const SYNC_BATCH = 200;

/** A member's profile visibility changed: their copies move between Browse's public and private
 * candidate ranges (`ownedPuzzles.ownerPrivate`, library/openListing). Their library can be large,
 * so the copies are re-stamped in batches after this transaction. */
export const scheduleOwnerListingSync = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<void> => {
  await ctx.scheduler.runAfter(
    0,
    internal.library.ownerListingVisibility.syncOwnerListings,
    { ownerId },
  );
};

// Re-stamps one page of the owner's copies with the listing fields for the owner's visibility as it
// is NOW (read per batch, so runs overlapping after quick flips all end on the latest value), and
// reschedules itself. Rows already in step are not written.
export const syncOwnerListings = internalMutation({
  args: { ownerId: v.id("users"), cursor: v.optional(v.string()) },
  handler: async (ctx, { ownerId, cursor }): Promise<void> => {
    const ownerPrivate =
      (await profileVisibilityOf(ctx, ownerId)) === "private";
    const page = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .paginate({ numItems: SYNC_BATCH, cursor: cursor ?? null });
    const now = Date.now();
    for (const row of page.page) {
      const state = listingStateOf(row, row, ownerPrivate, now);
      if (listingStateDiffers(row, state)) await ctx.db.patch(row._id, state);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.ownerListingVisibility.syncOwnerListings,
        { ownerId, cursor: page.continueCursor },
      );
    }
  },
});
