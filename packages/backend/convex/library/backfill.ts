import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// One-shot, idempotent migration so the new domain-driven Library functions (which look up by
// aggregateId) can act on legacy rows:
//   - stamp aggregateId on every ownedPuzzles/collections/categories row missing one;
//   - for ownedPuzzles, also resolve the referenced puzzles row, stamp ITS aggregateId if
//     missing (so the cross-reference is consistent), and derive the cached snapshot +
//     puzzleDefinitionId from it.
// Best-effort on legacy data; the new functions stay dormant until 2d regardless. Re-runnable:
// rows that already carry the fields are skipped. Run per table, paging in cursor batches
// (`batchSize` rows, default 100), one transaction each: pass `continueCursor` back as `cursor`
// until `isDone` is true:
//   npx convex run library/backfill:backfillLibrary '{"table":"ownedPuzzles"}'
//   npx convex run library/backfill:backfillLibrary '{"table":"collections"}'
//   npx convex run library/backfill:backfillLibrary '{"table":"categories"}'
//   (then '{"table":"…","cursor":"<continueCursor>"}' while isDone is false)
export const backfillLibrary = internalMutation({
  args: {
    table: v.union(
      v.literal("ownedPuzzles"),
      v.literal("collections"),
      v.literal("categories"),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { table, cursor, batchSize }) => {
    const paginationOpts = {
      cursor: cursor ?? null,
      numItems: batchSize ?? 100,
    };
    // Rows of `table` patched; for ownedPuzzles, of those, how many got a snapshot and how many
    // referenced puzzles got an aggregateId of their own.
    let patched = 0;
    let snapshotsPopulated = 0;
    let puzzlesStamped = 0;

    if (table === "ownedPuzzles") {
      const page = await ctx.db.query("ownedPuzzles").paginate(paginationOpts);
      for (const copy of page.page) {
        const patch: Record<string, unknown> = {};

        if (!copy.aggregateId) {
          patch.aggregateId = crypto.randomUUID();
        }

        // Resolve the referenced puzzle to derive the Catalog reference + cached snapshot.
        const needsSnapshot =
          copy.puzzleDefinitionId === undefined || copy.snapshot === undefined;
        if (needsSnapshot) {
          const puzzle = await ctx.db.get(copy.puzzleId);
          if (puzzle) {
            // Ensure the puzzle carries an aggregateId so the cross-reference is consistent.
            let puzzleAggregateId = puzzle.aggregateId;
            if (!puzzleAggregateId) {
              puzzleAggregateId = crypto.randomUUID();
              await ctx.db.patch(puzzle._id, {
                aggregateId: puzzleAggregateId,
              });
              puzzlesStamped++;
            }
            patch.puzzleDefinitionId = puzzleAggregateId;
            patch.snapshot = {
              title: puzzle.title,
              brand: puzzle.brand,
              pieceCount: puzzle.pieceCount,
              thumbnail: puzzle.image as unknown as string | undefined,
            };
            snapshotsPopulated++;
          }
        }

        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(copy._id, patch);
          patched++;
        }
      }
      return {
        table,
        scanned: page.page.length,
        patched,
        snapshotsPopulated,
        puzzlesStamped,
        isDone: page.isDone,
        continueCursor: page.isDone ? null : page.continueCursor,
      };
    }

    const page = await ctx.db.query(table).paginate(paginationOpts);
    for (const row of page.page) {
      if (row.aggregateId) continue;
      await ctx.db.patch(row._id, { aggregateId: crypto.randomUUID() });
      patched++;
    }
    return {
      table,
      scanned: page.page.length,
      patched,
      snapshotsPopulated,
      puzzlesStamped,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
