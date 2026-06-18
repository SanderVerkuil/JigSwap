import { internalMutation } from "../_generated/server";

// One-shot, idempotent migration: puzzles created before the domain catalog path never received
// an aggregateId, so the copy-acquisition flow (which resolves a definition by aggregateId)
// cannot reach them — in the add-to-library form their Save button stays disabled. library's
// backfill only stamps puzzles reachable through an existing copy, so never-acquired catalog
// rows stay unstamped; this sweep covers them.
//
// We use the row's own Convex _id as the aggregateId rather than a fresh UUID: the domain
// PuzzleDefinitionId does no runtime format validation, and every existing _id reference (legacy
// copies, plus copies acquired through the add/new _id fallback) then satisfies
// puzzleDefinitionId === aggregateId, so ownership and grouping stay consistent with no copy
// rewrite. Re-runnable: rows that already carry an aggregateId are skipped, never overwritten.
export const backfillPuzzleAggregateIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const puzzles = await ctx.db.query("puzzles").collect();

    let patched = 0;
    for (const puzzle of puzzles) {
      if (puzzle.aggregateId) continue;
      await ctx.db.patch(puzzle._id, {
        aggregateId: puzzle._id as unknown as string,
      });
      patched++;
    }

    return { patched };
  },
});
