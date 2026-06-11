import { internalMutation } from "../_generated/server";

// One-shot, idempotent migration so the new domain-driven Library functions (which look up by
// aggregateId) can act on legacy rows:
//   - stamp aggregateId on every ownedPuzzles/collections/categories row missing one;
//   - for ownedPuzzles, also resolve the referenced puzzles row, stamp ITS aggregateId if
//     missing (so the cross-reference is consistent), and derive the cached snapshot +
//     puzzleDefinitionId from it.
// Best-effort on legacy data; the new functions stay dormant until 2d regardless. Re-runnable:
// rows that already carry the fields are skipped.
export const backfillLibrary = internalMutation({
  args: {},
  handler: async (ctx) => {
    let ownedPuzzlesStamped = 0;
    let snapshotsPopulated = 0;
    let puzzlesStamped = 0;
    let collectionsStamped = 0;
    let categoriesStamped = 0;

    const ownedPuzzles = await ctx.db.query("ownedPuzzles").collect();
    for (const copy of ownedPuzzles) {
      const patch: Record<string, unknown> = {};

      if (!copy.aggregateId) {
        patch.aggregateId = crypto.randomUUID();
        ownedPuzzlesStamped++;
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
            await ctx.db.patch(puzzle._id, { aggregateId: puzzleAggregateId });
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
      }
    }

    const collections = await ctx.db.query("collections").collect();
    for (const collection of collections) {
      if (collection.aggregateId) continue;
      await ctx.db.patch(collection._id, { aggregateId: crypto.randomUUID() });
      collectionsStamped++;
    }

    const categories = await ctx.db.query("categories").collect();
    for (const category of categories) {
      if (category.aggregateId) continue;
      await ctx.db.patch(category._id, { aggregateId: crypto.randomUUID() });
      categoriesStamped++;
    }

    return {
      ownedPuzzlesStamped,
      snapshotsPopulated,
      puzzlesStamped,
      collectionsStamped,
      categoriesStamped,
    };
  },
});
