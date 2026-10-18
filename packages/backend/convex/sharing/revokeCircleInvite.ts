import { makeRevokeCircleInvite, toCircleInviteId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { circleInviteDeps } from "./adapters/circleInviteDeps";
import { toConvexError } from "./errors";

// Composition root: the inviter or any current Admin withdraws an open invite.
export const revokeCircleInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const result = await makeRevokeCircleInvite(circleInviteDeps(ctx))({
      actorId,
      inviteId: toCircleInviteId(args.inviteId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
