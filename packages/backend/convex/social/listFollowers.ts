import type { FollowEdgeView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toFollowEdgeView } from "./readViews";

// Read side: the members who follow the target (defaults to the acting member). Each entry resolves
// the FOLLOWER's display name. Returns typed FollowEdgeView DTOs.
export const listFollowers = query({
  args: { memberId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<FollowEdgeView[]> => {
    const target =
      args.memberId ?? ((await requireMember(ctx)) as unknown as Id<"users">);
    const rows = await ctx.db
      .query("follows")
      .withIndex("by_followee", (q) => q.eq("followeeId", target))
      .collect();
    return Promise.all(
      rows.map((r) =>
        toFollowEdgeView(ctx, r.aggregateId, r.followerId, r.createdAt),
      ),
    );
  },
});
