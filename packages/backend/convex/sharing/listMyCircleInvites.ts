import type { MyCircleInviteView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isBlockedEitherWay } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { circleByAggregateId, isCircleAdmin } from "./circleAccess";

// The signed-in member's open circle invites, newest first: the circle's name and size, the
// inviter (projected, salted per invite) and the offered seat. Never the member list or shared
// copies: a pending invite grants nothing. Invites that accept would refuse anyway (circle gone,
// inviter no longer an Admin, the pair now blocked) are left out rather than shown as dead ends.
export const listMyCircleInvites = query({
  args: {},
  handler: async (ctx): Promise<MyCircleInviteView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const invites = await ctx.db
      .query("circleInvites")
      .withIndex("by_invitee_status", (q) =>
        q.eq("inviteeId", viewerId).eq("status", "pending"),
      )
      .collect();

    const views: { createdAt: number; view: MyCircleInviteView }[] = [];
    for (const invite of invites) {
      if (invite.expiresAt <= now) continue;
      const circle = await circleByAggregateId(ctx, invite.circleAggregateId);
      if (!circle || !isCircleAdmin(circle, invite.inviterId)) continue;
      if (await isBlockedEitherWay(ctx, viewerId, invite.inviterId)) continue;
      views.push({
        createdAt: invite.createdAt,
        view: {
          inviteId: invite.aggregateId,
          circleName: circle.name,
          memberCount: circle.memberships.length,
          inviter: await projectMemberIdentity(
            ctx,
            viewerId,
            invite.inviterId,
            invite.aggregateId,
          ),
          permission: invite.permission,
          expiresAt: invite.expiresAt,
        },
      });
    }
    return views
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ view }) => view);
  },
});
