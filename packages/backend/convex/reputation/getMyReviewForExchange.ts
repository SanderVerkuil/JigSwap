import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side that tells the UI whether the acting member has ALREADY reviewed a given exchange, so
// it can hide/disable the submit form. `exchangeId` is the Exchange aggregateId (a string); it is
// resolved to the real `exchanges._id` FK before keying the by-exchange-reviewer index. Returns
// the review row or null.
export const getMyReviewForExchange = query({
  args: { exchangeId: v.string() },
  handler: async (ctx, args) => {
    const reviewerId = await requireMember(ctx);

    const byAggregateId = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.exchangeId),
      )
      .unique();
    const exchangeId =
      byAggregateId?._id ?? (args.exchangeId as unknown as Id<"exchanges">);

    return ctx.db
      .query("reviews")
      .withIndex("by_exchange_reviewer", (q) =>
        q
          .eq("exchangeId", exchangeId)
          .eq("reviewerId", reviewerId as unknown as Id<"users">),
      )
      .first();
  },
});
