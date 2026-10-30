import type { FollowEdgeView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "./blocks";
import { toFollowEdgeView } from "./readViews";

// Read side: the members who follow the CALLER. Each entry resolves the FOLLOWER's display name.
// Returns typed FollowEdgeView DTOs.
//
// SECURITY (SEC-13): a member reads only their own followers, so the query takes no member id.
// Another member's list would name every member who follows them, private members included, to any
// signed-in caller (the edge view projects no counterparty). Members blocked either way are left
// out (spec 2.6).
export const listFollowers = query({
  args: {},
  handler: async (ctx): Promise<FollowEdgeView[]> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const blockedIds = await blockedEitherWaySet(ctx, viewer);

    const rows = await ctx.db
      .query("follows")
      .withIndex("by_followee", (q) => q.eq("followeeId", viewer))
      .collect();
    return Promise.all(
      rows
        .filter((r) => !blockedIds.has(r.followerId))
        .map((r) =>
          toFollowEdgeView(ctx, r.aggregateId, r.followerId, r.createdAt),
        ),
    );
  },
});
