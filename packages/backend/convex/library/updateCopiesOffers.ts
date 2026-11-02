import {
  makeUpdateCopiesOffers,
  toCopyId,
  type CopyOffersSkipReason,
  type OwnerId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { convexCopyManagerPolicy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { convexCopyReservationPort } from "./adapters/convexCopyReservationPort";
import { libraryEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for My Puzzles' bulk offer actions (Offer for swap / Offer to lend / Withdraw
// offers). Each copy runs the same single-copy sharing use case as updateCopySharing, with the
// household manager policy and the reservation guard, and with offers only: every copy keeps its
// owner's visibility choice and sale price. A flag that is given is set on every copy; an omitted
// flag keeps each copy's own value. Copies the caller may not manage (or that don't exist), copies
// out on loan and reserved ones are skipped, not fatal. `copyIds` are domain aggregateIds, deduped, at most 100.
export const updateCopiesOffers = mutation({
  args: {
    copyIds: v.array(v.string()),
    forTrade: v.optional(v.boolean()),
    forLend: v.optional(v.boolean()),
    forSale: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    updated: number;
    unchanged: number;
    skipped: { copyId: string; reason: CopyOffersSkipReason }[];
  }> => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const update = makeUpdateCopiesOffers({
      copies: convexCopyRepository(ctx),
      reservations: convexCopyReservationPort(ctx),
      events: libraryEventPublisher(ctx),
      clock: systemClock,
      // Household members with manage permission act as co-owner, as on a single copy.
      managers: convexCopyManagerPolicy(ctx),
    });

    const result = await update({
      actingMemberId,
      copyIds: args.copyIds.map(toCopyId),
      offers: {
        forTrade: args.forTrade,
        forLend: args.forLend,
        forSale: args.forSale,
      },
    });
    if (result.isErr) throw toConvexError(result.error);
    return {
      updated: result.value.updated,
      unchanged: result.value.unchanged,
      skipped: result.value.skipped.map(({ copyId, reason }) => ({
        copyId: copyId as string,
        reason,
      })),
    };
  },
});
