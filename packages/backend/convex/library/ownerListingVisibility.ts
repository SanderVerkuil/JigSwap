import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";
import { markOwnerListingsChange } from "./definitionStats";
import { listingStateDiffers, listingStateOf } from "./openListing";

// Copies per batch: one read and at most one patch each.
export const SYNC_BATCH = 200;
// A run takes seconds. One still marked after this long died (it threw), so a new flip starts over.
export const SYNC_STALE_MS = 10 * 60 * 1000;

const profileRowOf = (ctx: MutationCtx, ownerId: Id<"users">) =>
  ctx.db
    .query("profiles")
    .withIndex("by_member", (q) => q.eq("memberId", ownerId))
    .unique();

/** A member's profile visibility changed: their copies move between Browse's public and private
 * candidate ranges (`ownedPuzzles.ownerPrivate`, library/openListing) and count differently in their
 * definitions' public availability. Their library can be large, so that is done in batches after
 * this transaction, by one run at a time per member: while one is going (`listingSyncSince`) a flip
 * starts nothing, and the run starts over at its end if it stamped a value that no longer holds. */
export const scheduleOwnerListingSync = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<void> => {
  const now = Date.now();
  const profile = await profileRowOf(ctx, ownerId);
  if (
    profile?.listingSyncSince !== undefined &&
    now - profile.listingSyncSince < SYNC_STALE_MS
  ) {
    return;
  }
  if (profile) await ctx.db.patch(profile._id, { listingSyncSince: now });
  await ctx.scheduler.runAfter(
    0,
    internal.library.ownerListingVisibility.syncOwnerListings,
    { ownerId },
  );
};

// Re-stamps one page of the owner's copies, and reschedules itself. A run stamps the one value it
// started with (`ownerPrivate`), or its earlier pages and later ones could disagree, and re-reads
// the owner's visibility when it reaches the end: if that changed, it starts over. Rows already in
// step are not written. Only when a row did change are the owner's definitions recounted
// (`changed`), once per run, after the last page: flips that cancel out cost a read of the library.
export const syncOwnerListings = internalMutation({
  args: {
    ownerId: v.id("users"),
    cursor: v.optional(v.string()),
    ownerPrivate: v.optional(v.boolean()),
    changed: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { ownerId, cursor } = args;
    const current = (await profileVisibilityOf(ctx, ownerId)) === "private";
    const ownerPrivate = args.ownerPrivate ?? current;
    let changed = args.changed ?? false;
    const page = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .paginate({ numItems: SYNC_BATCH, cursor: cursor ?? null });
    const now = Date.now();
    for (const row of page.page) {
      const state = listingStateOf(row, row, ownerPrivate, now);
      if (listingStateDiffers(row, state)) {
        await ctx.db.patch(row._id, state);
        changed = true;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.ownerListingVisibility.syncOwnerListings,
        { ownerId, cursor: page.continueCursor, ownerPrivate, changed },
      );
      return;
    }
    if (current !== ownerPrivate) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.ownerListingVisibility.syncOwnerListings,
        { ownerId, changed },
      );
      return;
    }
    const profile = await profileRowOf(ctx, ownerId);
    if (profile?.listingSyncSince !== undefined) {
      await ctx.db.patch(profile._id, { listingSyncSince: undefined });
    }
    if (changed) await markOwnerListingsChange(ctx, ownerId);
  },
});
