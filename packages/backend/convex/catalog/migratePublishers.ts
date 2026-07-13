import { matchKnownPublisher, puzzleSearchableText } from "@jigswap/domain";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// One-shot migration for the publisher/brand split: `brand` values that are really publisher
// COMPANIES (per the domain known-publishers allowlist) move to the new `publisher` column and
// `brand` is cleared; product lines ("Jan van Haasteren", "Wasgij") and unknowns are untouched.
// searchableText is recomputed via the same domain projection the aggregate uses, so a search
// for "ravensburger" keeps matching after the value leaves `brand`.
// Idempotent: rows that already carry a publisher are skipped.
// Run manually (dry run FIRST, eyeball `changes`, then for real):
//   npx convex run catalog/migratePublishers:run
//   npx convex run catalog/migratePublishers:run '{"dryRun": false}'
export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true; // safe by default
    const puzzles = await ctx.db.query("puzzles").collect();

    const changes: Array<{ title: string; from: string; to: string }> = [];
    for (const puzzle of puzzles) {
      if (!puzzle.brand || puzzle.publisher) continue;
      const publisher = matchKnownPublisher(puzzle.brand);
      if (!publisher) continue;

      changes.push({ title: puzzle.title, from: puzzle.brand, to: publisher });
      if (dryRun) continue;

      await ctx.db.patch(puzzle._id, {
        brand: undefined, // Convex patch semantics: undefined REMOVES the field
        publisher,
        searchableText: puzzleSearchableText({
          title: puzzle.title,
          publisher,
          artist: puzzle.artist,
          series: puzzle.series,
          tags: puzzle.tags,
        }),
      });
    }
    return { dryRun, total: puzzles.length, moved: changes.length, changes };
  },
});
