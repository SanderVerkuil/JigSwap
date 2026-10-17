import {
  makeAcceptHouseholdInvite,
  toHouseholdInviteId,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the invitee accepts and joins the household. The use case is the authoritative
// at-most-one-household check (the invitee may have joined another household since the invite).
// The body is shared with notifications/act (Accept from a notification).
export const acceptHouseholdInviteUseCase = async (
  ctx: MutationCtx,
  actorId: MemberId,
  args: { inviteId: string },
): Promise<string> => {
  const result = await makeAcceptHouseholdInvite(householdDeps(ctx))({
    actorId,
    inviteId: toHouseholdInviteId(args.inviteId),
  });
  if (result.isErr) throw toConvexError(result.error);
  return result.value as string;
};

export const acceptHouseholdInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args): Promise<string> =>
    acceptHouseholdInviteUseCase(ctx, await requireMember(ctx), args),
});
