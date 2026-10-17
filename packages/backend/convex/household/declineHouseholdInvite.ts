import {
  makeDeclineHouseholdInvite,
  toHouseholdInviteId,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the invitee declines (silent to the inviter). The body is shared with
// notifications/act (Decline from a notification).
export const declineHouseholdInviteUseCase = async (
  ctx: MutationCtx,
  actorId: MemberId,
  args: { inviteId: string },
): Promise<void> => {
  const result = await makeDeclineHouseholdInvite(householdDeps(ctx))({
    actorId,
    inviteId: toHouseholdInviteId(args.inviteId),
  });
  if (result.isErr) throw toConvexError(result.error);
};

export const declineHouseholdInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<void> =>
    declineHouseholdInviteUseCase(ctx, await requireMember(ctx), args),
});
