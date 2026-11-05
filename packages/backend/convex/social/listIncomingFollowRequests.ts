import type { IncomingFollowRequestView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "./blocks";
import { memberTeaserIdentityOf } from "./privacy";

// Read side: the acting member's pending incoming follow requests, joined with the requester's
// identity and whether the member already follows them back (drives the "Approve & follow back"
// affordance). The requester initiated contact, so they are named even when private, but only
// with what their own link (/members/$handle) discloses: name, handle and avatar, never bio,
// location or language (SEC-11, as getFollowRequesterPreview).
export const listIncomingFollowRequests = query({
  args: {},
  handler: async (ctx): Promise<IncomingFollowRequestView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    const pending = await ctx.db
      .query("followRequests")
      .withIndex("by_target_status", (q) =>
        q.eq("targetId", me).eq("status", "pending"),
      )
      .collect();

    const blockedIds = await blockedEitherWaySet(ctx, me);
    const result: IncomingFollowRequestView[] = [];
    for (const row of pending) {
      if (blockedIds.has(row.requesterId)) continue;
      // Skip deleted AND deactivated requesters (mirrors the teaser's gate): a deactivated
      // member must not render as an actionable request with a dead profile link.
      const user = await ctx.db.get(row.requesterId);
      if (!user || !user.isActive) continue;
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", row.requesterId))
        .unique();
      const followsBack = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", me).eq("followeeId", row.requesterId),
        )
        .first();
      result.push({
        requestId: row.aggregateId,
        requestedAt: row.createdAt,
        requester: memberTeaserIdentityOf(user, profile, true),
        alreadyFollowing: followsBack !== null,
      });
    }
    return result.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});
