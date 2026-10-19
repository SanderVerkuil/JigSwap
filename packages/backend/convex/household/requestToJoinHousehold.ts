import {
  makeRequestToJoinHousehold,
  toHouseholdId,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { isBlockedEitherWay } from "../social/blocks";
import { requireRequestableHouseholdLink } from "../social/householdLinkInvite";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: ask to join the household an EXPIRED or USED household invite link was minted
// for (the signed-in landing's "Ask to join"). The token is resolved server-side; every other link
// state refuses with the same codes as Accept (a live link with InviteLinkLive). A member in a
// household must pass leaveCurrentHousehold (else AlreadyInHousehold). The answer is the same
// { requestId } whether or not the request reaches anyone: when the household is gone, its owner is
// no longer its admin, or the pair is blocked either way, it is stored as dropped and nobody is
// told. Rate-limited (householdJoinRequest) before any lookup.
export const requestToJoinHousehold = mutation({
  args: { token: v.string(), leaveCurrentHousehold: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { token, leaveCurrentHousehold },
  ): Promise<{ requestId: string }> => {
    const actorId = await requireMember(ctx);
    const memberId = actorId as unknown as Id<"users">;
    await enforceRateLimit(ctx, "householdJoinRequest", memberId);
    const link = await requireRequestableHouseholdLink(
      ctx,
      token,
      memberId,
      Date.now(),
    );

    const requestToJoinUseCase = makeRequestToJoinHousehold(householdDeps(ctx));
    const result = await requestToJoinUseCase({
      actorId,
      householdId: toHouseholdId(link.context.householdId),
      adminId: toMemberId(link.ownerId),
      linkId: link._id,
      blocked: await isBlockedEitherWay(ctx, link.ownerId, memberId),
      leaveCurrentHousehold,
    });
    if (result.isErr) throw toConvexError(result.error);
    return { requestId: result.value as string };
  },
});
