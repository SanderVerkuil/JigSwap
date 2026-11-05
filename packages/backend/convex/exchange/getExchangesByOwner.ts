import type { ExchangeSummaryView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { enrichExchangeSummary, readMemberExchanges } from "./readViews";

// Exchange read (thin adapter): exchanges where the signed-in member is the recipient (incoming).
// Returns [] when unauthenticated, unknown or deactivated, newest-first — matching legacy
// exchanges.getExchangesByOwner.
// Kept for web builds from before the Exchanges page moved to listMyLiveExchanges and
// listMyExchangeHistory: this build no longer calls it. Remove once those have aged out.
export const getExchangesByOwner = query({
  args: {},
  handler: async (ctx): Promise<ExchangeSummaryView[]> => {
    const me = await optionalActingMember(ctx);
    if (!me) return [];

    // Bounded: the newest EXCHANGE_LIST_CAP plus the newest EXCHANGE_LIST_CAP still-open ones.
    const exchanges = await readMemberExchanges(ctx, me, "recipient");

    const enriched = await Promise.all(
      exchanges.map((tr) => enrichExchangeSummary(ctx, tr, me)),
    );
    return enriched.sort((a, b) => b.createdAt - a.createdAt);
  },
});
