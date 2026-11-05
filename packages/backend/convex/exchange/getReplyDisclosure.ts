import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isRevealedByOrdinaryRules } from "../social/privacy";
import { hasTradeReveal } from "./tradeParty";

// The reply-flow notice, the owner's side of getRequestDisclosure. The owner's first message in an
// exchange's own thread reveals their trade card (display name, handle, reviews received) to the
// requester inside that exchange (exchange/tradeRevealSubscriber, reason "owner_replied"); never
// their email, which only their own share reveals (exchange/setContactSharing). `revealsYou` is
// true while such a reply would reveal something new: the owner has not accepted or replied yet
// (no tradeReveals row), and the requester can't already see them by the ordinary rules (public
// profile or mutual followers), as exchange/tradeParty decides.
//
// Null for anyone but the exchange's owner, and for an unknown exchange. Every fact is one the
// owner already knows (their own visibility, follows and actions), and blocks are ignored on
// purpose, so the answer discloses nothing about the requester.
export const getReplyDisclosure = query({
  // The Exchange aggregateId, as inbox threads carry it (raw `_id` for pre-aggregateId rows).
  args: { exchangeId: v.string() },
  handler: async (ctx, args): Promise<{ revealsYou: boolean } | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const exchange = await exchangeByRef(ctx, args.exchangeId);
    if (!exchange || exchange.recipientId !== viewerId) return null;
    if (await hasTradeReveal(ctx, exchange._id)) return { revealsYou: false };
    return {
      revealsYou: !(await isRevealedByOrdinaryRules(
        ctx,
        exchange.initiatorId,
        viewerId,
      )),
    };
  },
});

// Resolve the exchange from its aggregateId; exchanges that predate aggregateId fall back to the
// value as a raw `_id` (mirrors conversation/getThreadByExchange).
const exchangeByRef = async (
  ctx: QueryCtx,
  ref: string,
): Promise<Doc<"exchanges"> | null> => {
  const byAggregateId = await ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", ref))
    .unique();
  if (byAggregateId) return byAggregateId;
  const id = ctx.db.normalizeId("exchanges", ref);
  return id ? ctx.db.get(id) : null;
};
