import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// One-shot migration: legacy createExchange never set aggregateId, so the new
// domain lifecycle functions (which look up by aggregateId) can't act on those
// rows. Stamp a fresh ExchangeId on every row still missing one. Idempotent. Pages
// the table in cursor batches (`batchSize` rows, default 100), one transaction
// each: run it, then pass `continueCursor` back as `cursor` until `isDone` is true:
//   npx convex run exchange/backfill:backfillAggregateIds
//   npx convex run exchange/backfill:backfillAggregateIds '{"cursor":"<continueCursor>"}'
export const backfillAggregateIds = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.db
      .query("exchanges")
      .paginate({ cursor: cursor ?? null, numItems: batchSize ?? 100 });

    let patched = 0;
    for (const exchange of page.page) {
      if (exchange.aggregateId) continue;
      await ctx.db.patch(exchange._id, { aggregateId: crypto.randomUUID() });
      patched++;
    }

    return {
      scanned: page.page.length,
      patched,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
