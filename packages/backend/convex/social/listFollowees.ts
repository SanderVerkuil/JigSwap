import type { FollowEdgeView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toFollowEdgeView } from "./readViews";

// Read side: the members the target follows (defaults to the acting member). Each entry resolves
// the FOLLOWEE's display name. Returns typed FollowEdgeView DTOs.
export const listFollowees = query({
  args: { memberId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<FollowEdgeView[]> => {
    const target =
      args.memberId ?? ((await requireMember(ctx)) as unknown as Id<"users">);
    const rows = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", target))
      .collect();
    return Promise.all(
      rows.map((r) =>
        toFollowEdgeView(ctx, r.aggregateId, r.followeeId, r.createdAt),
      ),
    );
  },
});
