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
    const row = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", followerId))
      .filter((q) => q.eq(q.field("followeeId"), args.followeeId))
      .unique();
    return row !== null;
  },
});
