import type { ExchangeSummaryView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { enrichExchangeSummary } from "./readViews";

// Exchange read: one exchange as the Exchanges page lists it, for a deep link to one that isn't among
// the pages loaded so far (a notification about an old finished exchange). `exchange` is what the
// link carries: the domain id, or the row id on older links. Party-only: anyone else gets null, as
// does an unknown id, so it never confirms that an exchange exists.
export const getMyExchangeSummary = query({
  args: { exchange: v.string() },
  handler: async (ctx, args): Promise<ExchangeSummaryView | null> => {
    const me = await optionalActingMember(ctx);
    if (!me) return null;
    const rowId = ctx.db.normalizeId("exchanges", args.exchange);
    const row = rowId
      ? await ctx.db.get(rowId)
      : await ctx.db
          .query("exchanges")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", args.exchange),
          )
          .first();
    if (!row || (row.initiatorId !== me && row.recipientId !== me)) return null;
    return enrichExchangeSummary(
      ctx,
      row,
      me,
      row.initiatorId === me ? "requester" : "owner",
    );
  },
});
