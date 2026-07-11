import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";

// Read side: the acting member's pending incoming follow requests, joined with the
// requester's member view and whether the member already follows them back (drives the
// "Approve & follow back" affordance). Requesters of a request addressed TO you are by
// definition allowed to be shown to you — no extra projection needed.
export const listIncomingFollowRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    const pending = await ctx.db
      .query("followRequests")
      .withIndex("by_target_status", (q) =>
        q.eq("targetId", me).eq("status", "pending"),
      )
      .collect();

    const result = [];
    for (const row of pending) {
      const user = await ctx.db.get(row.requesterId);
      if (!user) continue;
      const requester = toMemberView(user);
      const followsBack = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", me).eq("followeeId", row.requesterId),
        )
        .first();
      result.push({
        requestId: row.aggregateId,
        requestedAt: row.createdAt,
        requester,
        alreadyFollowing: followsBack !== null,
      });
    }
    return result.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});
