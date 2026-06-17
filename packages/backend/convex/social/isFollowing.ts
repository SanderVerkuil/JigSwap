import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side: whether the acting member already follows `followeeId`. Drives the follow/unfollow
// button state. Auth-gated; the follower is the acting member.
export const isFollowing = query({
  args: { followeeId: v.id("users") },
  handler: async (ctx, args): Promise<boolean> => {
    const followerId = (await requireMember(ctx)) as unknown as Id<"users">;
    // Use the compound (followerId, followeeId) index rather than scanning all of
    // the follower's edges and filtering. `.first()` is duplicate-tolerant
    // (matches areMutualFollowers in privacy.ts) so a stray duplicate edge never
    // 500s the follow/unfollow button state.
    const row = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", followerId).eq("followeeId", args.followeeId),
      )
      .first();
    return row !== null;
  },
});
