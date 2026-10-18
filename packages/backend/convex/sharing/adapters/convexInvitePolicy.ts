import type { InvitePolicy, MemberId } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { participantsKeyOf } from "../../conversation/adapters/threadMapper";
import { isBlockedEitherWay } from "../../social/blocks";
import { areMutualFollowers } from "../../social/privacy";

type Member = Id<"users"> | MemberId;
const asUserId = (m: Member) => m as unknown as Id<"users">;

/** Any existing thread between the pair, regardless of subject kind. */
export const hasPairThread = async (
  ctx: QueryCtx,
  a: Member,
  b: Member,
): Promise<boolean> =>
  (await ctx.db
    .query("threads")
    .withIndex("by_participants_key", (q) =>
      q.eq(
        "participantsKey",
        participantsKeyOf([a as MemberId, b as MemberId]),
      ),
    )
    .first()) !== null;

/**
 * The circle-invite contact rule: not blocked either way, AND a mutual follow or an existing pair
 * thread. It is the ConnectionPolicy WITHOUT its shared-circle clause, so sharing one circle never
 * lets an Admin pull a stranger into another.
 */
export const mayInvite = async (
  ctx: QueryCtx,
  actor: Member,
  invitee: Member,
): Promise<boolean> => {
  if (asUserId(actor) === asUserId(invitee)) return false;
  if (await isBlockedEitherWay(ctx, actor, invitee)) return false;
  if (await areMutualFollowers(ctx, asUserId(actor), asUserId(invitee))) {
    return true;
  }
  return hasPairThread(ctx, actor, invitee);
};

// Driven adapter for the InvitePolicy port. Read-only, so typed over QueryCtx.
export const convexInvitePolicy = (ctx: QueryCtx): InvitePolicy => ({
  canInvite: (actor, invitee) => mayInvite(ctx, actor, invitee),
  isBlockedEitherWay: (a, b) => isBlockedEitherWay(ctx, a, b),
});
