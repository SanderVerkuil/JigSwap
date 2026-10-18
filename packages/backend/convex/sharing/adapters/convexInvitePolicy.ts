import type { InvitePolicy, MemberId } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isBlockedEitherWay } from "../../social/blocks";
import { areMutualFollowers } from "../../social/privacy";

type Member = Id<"users"> | MemberId;
const asUserId = (m: Member) => m as unknown as Id<"users">;

/**
 * The circle-invite contact rule: not blocked either way, AND a mutual follow. Deliberately
 * narrower than the ConnectionPolicy: a shared circle doesn't count, and neither does a pair
 * thread, because a thread can exist without the invitee's consent (a DM opened through a shared
 * circle, or an exchange proposal on one of their copies). A mutual follow needs both sides.
 */
export const mayInvite = async (
  ctx: QueryCtx,
  actor: Member,
  invitee: Member,
): Promise<boolean> => {
  if (asUserId(actor) === asUserId(invitee)) return false;
  if (await isBlockedEitherWay(ctx, actor, invitee)) return false;
  return areMutualFollowers(ctx, asUserId(actor), asUserId(invitee));
};

// Driven adapter for the InvitePolicy port. Read-only, so typed over QueryCtx.
export const convexInvitePolicy = (ctx: QueryCtx): InvitePolicy => ({
  canInvite: (actor, invitee) => mayInvite(ctx, actor, invitee),
  isBlockedEitherWay: (a, b) => isBlockedEitherWay(ctx, a, b),
});
