import type { FollowersYouKnowView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { isBlockedEitherWay } from "./blocks";
import { knownFollowerIds } from "./knownFollowers";
import { areMutualFollowers, profileVisibilityOf } from "./privacy";

// The preview + short modal list are capped to the same small number — a profile row doesn't
// need (or want) to resolve a full intersection, just enough names to feel like social proof.
const PREVIEW_LIMIT = 8;
// Bound on the viewer's own followers read for the mutual check; matches knownFollowers' bounds.
const FOLLOW_GRAPH_CAP = 2000;

// Read side: "followers you know" social proof for `memberId`'s profile — accounts the VIEWER
// follows who also follow `memberId` (see social/knownFollowers.ts). Personalized and
// requireMember-gated: the viewer is resolved from auth, never trusted from the client. On your
// own profile there's nothing to show (you don't need social proof about yourself), so
// memberId === viewer short-circuits to empty. The resolved preview members are drawn from the
// viewer's OWN following list, so their identity needs no extra gate for this viewer.
//
// SECURITY (SEC-41): what the row DOES disclose about each listed member is one of THEIR follow
// edges ("they follow memberId"). A member's follow graph reaches only viewers who could read it
// on their profile: their profile is public, or the two are mutual followers. So a private member
// the viewer follows only one way is dropped from both `total` and the preview, before either is
// computed; otherwise a one-way follower could probe whom a private member follows by opening
// public profiles. (identity/searchUsers still ranks by the unfiltered intersection count, a
// residual ordering signal only.)
//
// SECURITY: this leaks a personalized SLICE of the target's follower set, which a private
// profile otherwise only exposes as an aggregate followerCount (getPublicProfile). So it follows
// the SAME follow-graph visibility model as social/listFollowers: a private target's followers
// are disclosed only to the target themself (already short-circuited above) and to mutual
// followers — every other viewer gets empty, even if they'd otherwise have an intersection. This
// stops an authed member who knows a private member's id from bypassing the unlocked-only UI to
// enumerate which of their followees follow that private member.
export const followersYouKnow = query({
  args: { memberId: v.id("users") },
  handler: async (ctx, args): Promise<FollowersYouKnowView> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    if (args.memberId === viewer) return { total: 0, members: [] };
    if (await isBlockedEitherWay(ctx, viewer, args.memberId)) {
      return { total: 0, members: [] };
    }

    if (
      (await profileVisibilityOf(ctx, args.memberId)) === "private" &&
      !(await areMutualFollowers(ctx, viewer, args.memberId))
    ) {
      return { total: 0, members: [] };
    }

    const ids = await visibleFollowGraphs(
      ctx,
      viewer,
      await knownFollowerIds(ctx, viewer, args.memberId),
    );
    const preview = ids.slice(0, PREVIEW_LIMIT);

    const resolved = await Promise.all(
      preview.map(async (memberId) => {
        const [user, profile] = await Promise.all([
          ctx.db.get(memberId),
          ctx.db
            .query("profiles")
            .withIndex("by_member", (q) => q.eq("memberId", memberId))
            .unique(),
        ]);
        if (!user) return null;
        return {
          memberId,
          displayName: memberDisplayNameOf(user, profile),
          avatar: user.avatar,
          username: user.username,
          slug: user.slug,
        };
      }),
    );

    return {
      total: ids.length,
      members: resolved.filter((m): m is NonNullable<typeof m> => m !== null),
    };
  },
});

// Keep the known followers whose follow graph the viewer may see (SEC-41): a public profile, or a
// mutual follower. Every id is already in the viewer's following, so "mutual" is "follows the
// viewer back", read once as a set (bounded like the intersection itself) rather than per member;
// anyone past that bound falls back to the visibility check, which fails closed. Memoised per id.
const visibleFollowGraphs = async (
  ctx: QueryCtx,
  viewer: Id<"users">,
  ids: Id<"users">[],
): Promise<Id<"users">[]> => {
  if (ids.length === 0) return ids;
  const followsViewer = new Set(
    (
      await ctx.db
        .query("follows")
        .withIndex("by_followee", (q) => q.eq("followeeId", viewer))
        .take(FOLLOW_GRAPH_CAP)
    ).map((row) => row.followerId),
  );
  const visible = new Map<Id<"users">, boolean>();
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
