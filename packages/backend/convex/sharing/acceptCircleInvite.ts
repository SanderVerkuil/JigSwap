import { makeAcceptCircleInvite, toCircleInviteId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { circleInviteDeps } from "./adapters/circleInviteDeps";
import { toConvexError } from "./errors";

// Composition root: the invitee accepts and joins the circle at the invite's permission (through
// Circle.admitInvitee, in this same transaction). Returns the CircleId joined.
export const acceptCircleInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const actorId = await requireMember(ctx);
    const result = await makeAcceptCircleInvite(circleInviteDeps(ctx))({
      actorId,
      inviteId: toCircleInviteId(args.inviteId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
