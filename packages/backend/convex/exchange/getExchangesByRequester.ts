import type { ExchangeSummaryView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { enrichExchangeSummary } from "./readViews";

// Exchange read (thin adapter): exchanges where the signed-in member is the initiator (outgoing).
// Returns [] when unauthenticated/unknown, newest-first — matching legacy exchanges.getExchangesByRequester.
export const getExchangesByRequester = query({
  args: {},
  handler: async (ctx): Promise<ExchangeSummaryView[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return [];

    const exchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_initiator", (q) => q.eq("initiatorId", user._id))
      .collect();

    const enriched = await Promise.all(
      exchanges.map((tr) => enrichExchangeSummary(ctx, tr, user._id)),
    );
    return enriched.sort((a, b) => b.createdAt - a.createdAt);
  },
});
