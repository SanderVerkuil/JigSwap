import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// One-off, idempotent backfill: legacy completions with a copy link but no puzzleId get the durable
// definition anchor derived from the copy. Rows whose copy was already deleted are skipped. Not part
// of the feature path. Pages the table in cursor batches (`batchSize` rows, default 100), one
// transaction each: run it, then pass `continueCursor` back as `cursor` until `isDone` is true:
//   npx convex run solving/backfillCompletionPuzzleId:run
//   npx convex run solving/backfillCompletionPuzzleId:run '{"cursor":"<continueCursor>"}'
export const run = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.db
      .query("completions")
      .paginate({ cursor: cursor ?? null, numItems: batchSize ?? 100 });
    let patched = 0;
    for (const row of page.page) {
      if (row.puzzleId || !row.ownedPuzzleId) continue;
      const copy = await ctx.db.get(row.ownedPuzzleId);
      if (!copy) continue;
      await ctx.db.patch(row._id, { puzzleId: copy.puzzleId });
      patched += 1;
    }
    return {
      scanned: page.page.length,
      patched,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
