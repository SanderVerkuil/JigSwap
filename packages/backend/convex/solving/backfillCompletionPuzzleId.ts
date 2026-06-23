import { internalMutation } from "../_generated/server";

// One-off, idempotent backfill: legacy completions with a copy link but no puzzleId get the durable
// definition anchor derived from the copy. Rows whose copy was already deleted are skipped. Run
// manually (npx convex run solving/backfillCompletionPuzzleId:run); not part of the feature path.
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("completions").collect();
    let patched = 0;
    for (const row of rows) {
      if (row.puzzleId || !row.ownedPuzzleId) continue;
      const copy = await ctx.db.get(row.ownedPuzzleId);
      if (!copy) continue;
      await ctx.db.patch(row._id, { puzzleId: copy.puzzleId });
      patched += 1;
    }
    return { scanned: rows.length, patched };
  },
});
