import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// One-shot, idempotent migration so the new domain-driven Solving functions (which look up by
// aggregateId) can act on legacy rows: stamp aggregateId on every completions/goals row missing
// one. Re-runnable: rows that already carry the field are skipped. The new functions stay dormant
// until the 3d UI ships regardless. Run per table, paging in cursor batches (`batchSize` rows,
// default 100), one transaction each: pass `continueCursor` back as `cursor` until `isDone`:
//   npx convex run solving/backfill:backfillSolving '{"table":"completions"}'
//   npx convex run solving/backfill:backfillSolving '{"table":"goals"}'
//   (then '{"table":"…","cursor":"<continueCursor>"}' while isDone is false)
export const backfillSolving = internalMutation({
  args: {
    table: v.union(v.literal("completions"), v.literal("goals")),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { table, cursor, batchSize }) => {
    const page = await ctx.db
      .query(table)
      .paginate({ cursor: cursor ?? null, numItems: batchSize ?? 100 });

    let patched = 0;
    for (const row of page.page) {
      if (row.aggregateId) continue;
      await ctx.db.patch(row._id, { aggregateId: crypto.randomUUID() });
      patched++;
    }

    return {
      table,
      scanned: page.page.length,
      patched,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
