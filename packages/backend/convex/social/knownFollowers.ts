import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Shared "followers you know" computation: the ids of members who follow `targetId` AND are
// followed by `viewerId` — i.e. (viewer's following) ∩ (target's followers). This is
// deliberately NOT plain mutual-followers (privacy.ts's areMutualFollowers, which asks whether
// viewer and target follow EACH OTHER): it is personalized social proof, one direction only,
// about accounts the viewer already trusts enough to follow. Reused by social/followersYouKnow
// (profile social-proof row) and by identity/searchUsers (known-follower ranking tiebreak) — keep
// this export clean and dependency-free (no privacy/visibility gating here; callers gate as needed).
export const knownFollowerIds = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
): Promise<Id<"users">[]> => {
  const viewerFollowing = await viewerFollowingSet(ctx, viewerId);
  return knownFollowerIdsOf(ctx, viewerId, viewerFollowing, targetId);
};

/** The count of `knownFollowerIds` — a trivial `.length`, exported so callers don't need the array. */
export const countKnownFollowers = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
): Promise<number> => (await knownFollowerIds(ctx, viewerId, targetId)).length;

// The viewer's following set, built ONCE from `follows` `by_follower`. Callers ranking many
// candidates against the same viewer (e.g. search-result ranking) build this once and pass it to
// `knownFollowerIdsOf`/`countKnownFollowersOf` instead of paying the `by_follower` scan per candidate.
export const viewerFollowingSet = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<Set<Id<"users">>> => {
  const followingRows = await ctx.db
    .query("follows")
    .withIndex("by_follower", (q) => q.eq("followerId", viewerId))
    .take(2000);
  return new Set(followingRows.map((r) => r.followeeId));
};

/** Same computation as `knownFollowerIds`, given a pre-built `viewerFollowingSet`. */
export const knownFollowerIdsOf = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  viewerFollowing: Set<Id<"users">>,
  targetId: Id<"users">,
): Promise<Id<"users">[]> => {
  const targetFollowerRows = await ctx.db
    .query("follows")
    .withIndex("by_followee", (q) => q.eq("followeeId", targetId))
    .take(2000);

  const ids: Id<"users">[] = [];
  for (const row of targetFollowerRows) {
    if (row.followerId === viewerId) continue;
    if (viewerFollowing.has(row.followerId)) ids.push(row.followerId);
  }
  return ids;
};

/** The count of `knownFollowerIdsOf` — a trivial `.length`, exported so callers don't need the array. */
export const countKnownFollowersOf = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  viewerFollowing: Set<Id<"users">>,
  targetId: Id<"users">,
): Promise<number> =>
  (await knownFollowerIdsOf(ctx, viewerId, viewerFollowing, targetId)).length;
