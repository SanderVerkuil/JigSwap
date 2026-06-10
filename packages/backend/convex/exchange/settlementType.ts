import type { MutationCtx } from "../_generated/server";

// Resolve a settled exchange's kind (legacy column names) by its aggregateId. Consumers of
// OwnershipTransferred use it to treat a loan (possession only) differently from a permanent
// swap/sale that actually moves ownership.
export const loadExchangeType = async (
  ctx: MutationCtx,
  exchangeAggregateId: string,
): Promise<"trade" | "sale" | "loan" | null> => {
  const row = await ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", exchangeAggregateId),
    )
    .unique();
  return row?.type ?? null;
};
