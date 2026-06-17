import type { FollowEdgeView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { areMutualFollowers, profileVisibilityOf } from "./privacy";
import { toFollowEdgeView } from "./readViews";

// Read side: the members the target follows (defaults to the acting member). Each entry resolves
// the FOLLOWEE's display name. Returns typed FollowEdgeView DTOs.
//
// SECURITY: always auth-gated — the acting member is resolved UNCONDITIONALLY (passing a `memberId`
// must not bypass authentication via `??` short-circuit). The follow graph follows the SAME
// visibility model as getProfile: a member whose profile is "private" exposes their following list
// only to themselves and to mutual followers; everyone else gets [].
export const listFollowees = query({
  args: { memberId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<FollowEdgeView[]> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const target = args.memberId ?? viewer;

    if (
      target !== viewer &&
      (await profileVisibilityOf(ctx, target)) === "private" &&
      !(await areMutualFollowers(ctx, viewer, target))
    ) {
      return [];
    }

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
