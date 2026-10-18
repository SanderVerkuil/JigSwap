import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { canViewCopy } from "../library/canViewCopy";
import { profileVisibilityOf } from "../social/privacy";

// The request-flow notice. Sending a request ALWAYS shares the requester's trade card with the
// copy's owner inside that trade (display name, handle, email, reviews received —
// exchange/tradeParty, getTradePartner), so the web always shows the notice; this query only tells
// it whether to add "your profile itself stays private" (`profilePrivate`).
//
// Returns null when unauthenticated, the copy is missing, the caller owns it (no request to make),
// or the caller may not view it (canViewCopy) — a missing and an unviewable copy answer the same,
// so this is not a copy-existence oracle. The answer depends only on the caller's OWN profile
// visibility, so it discloses nothing about the owner.
export const getRequestDisclosure = query({
  args: { requestedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<{ profilePrivate: boolean } | null> => {
    const callerId = await optionalActingMember(ctx);
    if (callerId === null) return null;
    const copy = await ctx.db.get(args.requestedPuzzleId);
    if (!copy || copy.ownerId === callerId) return null;
    if (!(await canViewCopy(ctx, callerId, copy))) return null;
    return {
      profilePrivate: (await profileVisibilityOf(ctx, callerId)) === "private",
    };
  },
});
