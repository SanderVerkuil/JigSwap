import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { blockedEitherWaySet } from "./blocks";
import { profileVisibilityOf } from "./privacy";

// Bound on the viewer's own followers read for the mutual check; matches the bounds below.
const FOLLOW_GRAPH_CAP = 2000;

// Shared "followers you know" computation: the ids of members who follow `targetId` AND are
// followed by `viewerId` — i.e. (viewer's following) ∩ (target's followers). This is
// deliberately NOT plain mutual-followers (privacy.ts's areMutualFollowers, which asks whether
// viewer and target follow EACH OTHER): it is personalized social proof, one direction only,
// about accounts the viewer already trusts enough to follow. Reused by social/followersYouKnow
// (profile social-proof row) and by identity/searchUsers (known-follower ranking tiebreak). Each
// id is one of that member's follow edges, so both pass the ids through followGraphFilter before
// they use them, counting included. Members blocked either way with the viewer are left out
// (spec 2.6).
export const knownFollowerIds = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
): Promise<Id<"users">[]> => {
  const viewerFollowing = await viewerFollowingSet(ctx, viewerId);
  const blockedIds = await blockedEitherWaySet(ctx, viewerId);
  return (
    await knownFollowerIdsOf(ctx, viewerId, viewerFollowing, targetId)
  ).filter((id) => !blockedIds.has(id));
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

/**
 * A filter keeping the known followers whose follow graph the viewer may see (SEC-41): a public
 * profile, or a mutual follower. A follow edge of a private member the viewer follows only one way
 * must not reach them in any form, as a name, a count or a result order, or they could probe whom
 * that member follows. Every id is already in the viewer's following, so "mutual" is "follows the
 * viewer back", read once as a set (bounded like the intersection itself, on first use) rather than
 * per member; anyone past that bound falls back to the visibility check, which fails closed. One
 * filter serves one read: it remembers each member's answer across calls. Not for concurrent use.
 */
export const followGraphFilter = (ctx: QueryCtx, viewerId: Id<"users">) => {
  let followsViewer: Set<Id<"users">> | undefined;
  const visible = new Map<Id<"users">, boolean>();
  return async (ids: Id<"users">[]): Promise<Id<"users">[]> => {
    if (ids.length === 0) return ids;
    followsViewer ??= new Set(
      (
        await ctx.db
          .query("follows")
          .withIndex("by_followee", (q) => q.eq("followeeId", viewerId))
          .take(FOLLOW_GRAPH_CAP)
      ).map((row) => row.followerId),
    );
    const kept: Id<"users">[] = [];
    for (const id of ids) {
      let ok = visible.get(id);
      if (ok === undefined) {
        ok =
          followsViewer.has(id) ||
          (await profileVisibilityOf(ctx, id)) === "public";
        visible.set(id, ok);
      }
      if (ok) kept.push(id);
    }
    return kept;
  };
};
