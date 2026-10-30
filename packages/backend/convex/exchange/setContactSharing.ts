import { tradeContactSharingOpen } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockStateBetween } from "../social/blocks";
import { contactShareOf, tradeSideOf } from "./tradeParty";

// A party turns sharing their email with the other party of ONE exchange on or off (the switch on
// the trade card). This is the only way an email reaches a trade partner: getTradePartner shows it
// through the domain rule tradeEmailVisible, which needs this consent. Turning it on is allowed
// only while sharing is open (accepted, completed or disputed, with no block either way); turning
// it off always is. Idempotent. A missing exchange and one the caller is not a party to fail alike.
export const setContactSharing = mutation({
  args: { exchangeId: v.id("exchanges"), share: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    const callerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const exchange = await ctx.db.get(args.exchangeId);
    const side = exchange ? tradeSideOf(exchange, callerId) : null;
    if (!exchange || side === null) {
      throw new ConvexError({
        code: "ExchangeNotFound",
        message: "Exchange not found",
      });
    }
    const existing = await contactShareOf(ctx, exchange._id, side);
    if (!args.share) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const partnerId =
      side === "initiator" ? exchange.recipientId : exchange.initiatorId;
    const blocked =
      (await blockStateBetween(ctx, callerId, partnerId)) !== undefined;
    if (!tradeContactSharingOpen({ status: exchange.status, blocked })) {
      throw new ConvexError({
        code: "ContactSharingClosed",
        message: "Email sharing is not open for this exchange",
      });
    }
    if (!existing) {
      await ctx.db.insert("tradeContactShares", {
        exchangeId: exchange._id,
        side,
        sharedAt: Date.now(),
      });
    }
    return null;
  },
});
