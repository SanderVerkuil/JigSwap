import type { ExchangeStatsView } from "@jigswap/contracts";
import { query } from "../_generated/server";

// Exchange read (thin adapter): platform-wide exchange counts by status. Buckets mirror the legacy
// exchanges.getExchangeStats exactly (note the `rejected` key, not `declined`).
export const getExchangeStats = query({
  args: {},
  handler: async (ctx): Promise<ExchangeStatsView> => {
    const allExchanges = await ctx.db.query("exchanges").collect();

    return {
      total: allExchanges.length,
      proposed: allExchanges.filter((t) => t.status === "proposed").length,
      accepted: allExchanges.filter((t) => t.status === "accepted").length,
      completed: allExchanges.filter((t) => t.status === "completed").length,
      rejected: allExchanges.filter((t) => t.status === "rejected").length,
      cancelled: allExchanges.filter((t) => t.status === "cancelled").length,
    };
  },
});
