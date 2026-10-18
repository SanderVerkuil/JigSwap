import type { CircleInviteView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { projectMemberIdentity } from "../social/privacy";
import { openInvitesOf, requireCircleAdmin } from "./circleAccess";

// A circle's open invites, newest first, for its Admins only (anyone else: CircleNotFound). The
// invitee and the inviter are projected through the privacy chokepoint, salted per invite.
export const listCircleInvites = query({
  args: { circleId: v.string() },
  handler: async (ctx, args): Promise<CircleInviteView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    await requireCircleAdmin(ctx, args.circleId, viewerId);

    const invites = await openInvitesOf(ctx, args.circleId, Date.now());
    const views = await Promise.all(
      invites.map(async (invite) => ({
        inviteId: invite.aggregateId,
        invitee: await projectMemberIdentity(
          ctx,
          viewerId,
          invite.inviteeId,
          invite.aggregateId,
        ),
        invitedBy: await projectMemberIdentity(
          ctx,
          viewerId,
          invite.inviterId,
          invite.aggregateId,
        ),
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
      })),
    );
    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});
