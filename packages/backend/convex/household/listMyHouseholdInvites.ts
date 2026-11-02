import type { HouseholdIncomingInviteView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { personView } from "./getMyHousehold";
import { isOpenHouseholdInvite } from "./memberships";

// The acting member's incoming pending household invites, newest first, with the inviter shown
// (the inviter initiated contact, as with follow requests). Only invites that can still be accepted
// (isOpenHouseholdInvite): a lapsed one, one whose inviter no longer runs the household, or one
// across a block is left out.
export const listMyHouseholdInvites = query({
  args: {},
  handler: async (ctx): Promise<HouseholdIncomingInviteView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const invites = await ctx.db
      .query("householdInvites")
      .withIndex("by_invitee_status", (q) =>
        q.eq("inviteeId", viewerId).eq("status", "pending"),
      )
      .collect();
    const views: HouseholdIncomingInviteView[] = [];
    for (const invite of invites) {
      if (!(await isOpenHouseholdInvite(ctx, invite, now))) continue;
      views.push({
        inviteId: invite.aggregateId,
        inviter: await personView(ctx, invite.inviterId),
        createdAt: invite.createdAt,
      });
    }
    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});
