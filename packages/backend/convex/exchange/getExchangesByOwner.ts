import type { ExchangeSummaryView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { enrichExchangeSummary, EXCHANGE_LIST_CAP } from "./readViews";

// Exchange read (thin adapter): exchanges where the signed-in member is the recipient (incoming).
// Returns [] when unauthenticated, unknown or deactivated, newest-first — matching legacy
// exchanges.getExchangesByOwner.
export const getExchangesByOwner = query({
  args: {},
  handler: async (ctx): Promise<ExchangeSummaryView[]> => {
    const me = await optionalActingMember(ctx);
    if (!me) return [];

    const exchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_recipient_created", (q) => q.eq("recipientId", me))
      .order("desc")
      .take(EXCHANGE_LIST_CAP);

    const enriched = await Promise.all(
      exchanges.map((tr) => enrichExchangeSummary(ctx, tr, me)),
    );
    return enriched.sort((a, b) => b.createdAt - a.createdAt);
  },
});
