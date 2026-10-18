import { makeDeclineCircleInvite, toCircleInviteId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { circleInviteDeps } from "./adapters/circleInviteDeps";
import { toConvexError } from "./errors";

// Composition root: the invitee declines. Silent to the inviter (no notification).
export const declineCircleInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const result = await makeDeclineCircleInvite(circleInviteDeps(ctx))({
      actorId,
      inviteId: toCircleInviteId(args.inviteId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
