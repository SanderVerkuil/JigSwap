import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { canViewCopy } from "../library/canViewCopy";
import { hasIdentityReveal } from "../social/identityReveals";
import {
  areMutualFollowers,
  profileVisibilityOf,
  projectMemberIdentity,
} from "../social/privacy";

// The request-flow notice: "sending this request shares your profile with the owner". Proposing an
// exchange grants the copy's owner a reveal of the requester (social/identityRevealSubscriber), so
// the requester is told up front whenever that changes anything — i.e. whenever they are currently
// ANONYMOUS to the owner. Returns null when unauthenticated, the copy is missing, the caller owns
// it (no request to make), or the caller may not view it (canViewCopy) — a missing and an
// unviewable copy answer the same, so this is not a copy-existence oracle.
//
// WHY this leaks nothing about the owner: the answer depends only on facts the caller already
// knows — their OWN profile visibility, whether they and the owner follow each other (a mutual
// follower is already revealed to the caller anyway), and grants toward the caller. A grant
// (owner -> caller) exists only because the caller themself proposed to that owner before, but it
// would still LINK this copy to an owner the caller proposed to earlier while that owner stays
// anonymous (copies' anonRefs are salted precisely so a hidden owner can't be correlated across
// copies). So the grant only counts when the caller can already identify the owner; otherwise the
// notice conservatively says the request reveals them (fails safe: an extra notice, never a leak).
export const getRequestDisclosure = query({
  args: { requestedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<{ revealsRequester: boolean } | null> => {
    const callerId = await optionalActingMember(ctx);
    if (callerId === null) return null;
    const copy = await ctx.db.get(args.requestedPuzzleId);
    if (!copy || copy.ownerId === callerId) return null;
    if (!(await canViewCopy(ctx, callerId, copy))) return null;
    const ownerId: Id<"users"> = copy.ownerId;

    return {
      revealsRequester: !(await ownerSeesCaller(
        ctx,
        ownerId,
        callerId,
        copy._id,
      )),
    };
  },
});

// projectMemberIdentity(owner -> caller) minus the cross-copy linkage described above.
const ownerSeesCaller = async (
  ctx: QueryCtx,
  ownerId: Id<"users">,
  callerId: Id<"users">,
  salt: string,
): Promise<boolean> => {
  if ((await profileVisibilityOf(ctx, callerId)) === "public") return true;
  if (await areMutualFollowers(ctx, ownerId, callerId)) return true;
  if (!(await hasIdentityReveal(ctx, ownerId, callerId))) return false;
  // Granted: count it only when the caller can already identify this owner.
  return !(await projectMemberIdentity(ctx, callerId, ownerId, salt)).anonymous;
};
