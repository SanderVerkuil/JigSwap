import { internalMutation } from "../_generated/server";

// One-shot migration: legacy createExchange never set aggregateId, so the new
// domain lifecycle functions (which look up by aggregateId) can't act on those
// rows. Stamp a fresh ExchangeId on every row still missing one.
export const backfillAggregateIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const exchanges = await ctx.db.query("exchanges").collect();

    let patched = 0;
    for (const exchange of exchanges) {
      if (exchange.aggregateId) continue;
      await ctx.db.patch(exchange._id, { aggregateId: crypto.randomUUID() });
      patched++;
    }

    return { patched };
  },
});
