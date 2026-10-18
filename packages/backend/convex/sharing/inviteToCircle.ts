import { makeInviteToCircle, toCircleId, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { circleInviteDeps } from "./adapters/circleInviteDeps";
import { toConvexError } from "./errors";

// Composition root: a circle Admin invites a member they may contact (not blocked either way, and
// a mutual follow or an existing pair thread). Every contact-rule failure is the one generic
// CannotInvite. A repeat while an invite is open returns that invite's id. Rate limited per
// inviter BEFORE any lookup, so probing who is contactable is throttled too.
export const inviteToCircle = mutation({
  args: {
    circleId: v.string(),
    inviteeId: v.id("users"),
    permission: v.union(
      v.literal("ViewOnly"),
      v.literal("Exchange"),
      v.literal("Admin"),
    ),
  },
  handler: async (ctx, args): Promise<string> => {
    const actorId = await requireMember(ctx);
    await enforceRateLimit(ctx, "circleInvite", actorId as string);

    const result = await makeInviteToCircle(circleInviteDeps(ctx))({
      circleId: toCircleId(args.circleId),
      actorId,
      inviteeId: toMemberId(args.inviteeId),
      permission: args.permission,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
