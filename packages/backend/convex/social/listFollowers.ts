import type { FollowEdgeView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { areMutualFollowers, profileVisibilityOf } from "./privacy";
import { toFollowEdgeView } from "./readViews";

// Read side: the members who follow the target (defaults to the acting member). Each entry resolves
// the FOLLOWER's display name. Returns typed FollowEdgeView DTOs.
//
// SECURITY: always auth-gated — the acting member is resolved UNCONDITIONALLY (passing a `memberId`
// must not bypass authentication via `??` short-circuit). The follow graph follows the SAME
// visibility model as getProfile: a member whose profile is "private" exposes their follower list
// only to themselves and to mutual followers; everyone else gets [].
export const listFollowers = query({
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
      .withIndex("by_followee", (q) => q.eq("followeeId", target))
      .collect();
    return Promise.all(
      rows.map((r) =>
        toFollowEdgeView(ctx, r.aggregateId, r.followerId, r.createdAt),
      ),
    );
  },
});
