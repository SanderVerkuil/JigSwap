import {
  makeUpdateCopySharing,
  type OwnerId,
  Price,
  toCopyId,
  type Visibility,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { convexCopyReservationPort } from "./adapters/convexCopyReservationPort";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for replacing a copy's sharing setting. The reserved-copy guard (a copy
// reserved by an active exchange cannot be made available) is enforced in the use case via the
// reservation port. `copyId` is the domain aggregateId.
export const updateCopySharing = mutation({
  args: {
    copyId: v.string(),
    visibility: v.union(v.literal("private"), v.literal("visible")),
    forTrade: v.optional(v.boolean()),
    forSale: v.optional(v.boolean()),
    forLend: v.optional(v.boolean()),
    salePrice: v.optional(
      v.object({ amountCents: v.number(), currency: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    let salePrice: Price | undefined;
    if (args.salePrice) {
      const result = Price.create(
        args.salePrice.amountCents,
        args.salePrice.currency,
      );
      if (result.isErr) throw toConvexError(result.error);
      salePrice = result.value;
    }

    const update = makeUpdateCopySharing({
      copies: convexCopyRepository(ctx),
      reservations: convexCopyReservationPort(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await update({
      actingMemberId,
      copyId: toCopyId(args.copyId),
      visibility: args.visibility as Visibility,
      forTrade: args.forTrade,
      forSale: args.forSale,
      forLend: args.forLend,
      salePrice,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
