import { matchKnownPublisher, puzzleSearchableText } from "@jigswap/domain";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// One-shot migration for the publisher/brand split: `brand` values that are really publisher
// COMPANIES (per the domain known-publishers allowlist) move to the new `publisher` column and
// `brand` is cleared; product lines ("Jan van Haasteren", "Wasgij") and unknowns are untouched.
// searchableText is recomputed via the same domain projection the aggregate uses, so a search
// for "ravensburger" keeps matching after the value leaves `brand`.
// Idempotent: rows that already carry a publisher are skipped. `updatedAt` is deliberately NOT
// stamped: this is a data-model cleanup, not a content edit (it would only shift sitemap
// <lastmod>). Pages the table in cursor batches (`batchSize` rows, default 100), one transaction
// each; `changes` lists the moves of that page only.
// Run manually (dry run FIRST over every page, eyeball `changes`, then for real), passing
// `continueCursor` back as `cursor` until `isDone` is true:
//   npx convex run catalog/migratePublishers:run
//   npx convex run catalog/migratePublishers:run '{"cursor":"<continueCursor>"}'
//   npx convex run catalog/migratePublishers:run '{"dryRun": false}'
//   npx convex run catalog/migratePublishers:run '{"dryRun": false, "cursor":"<continueCursor>"}'
export const run = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true; // safe by default
    const page = await ctx.db.query("puzzles").paginate({
      cursor: args.cursor ?? null,
      numItems: args.batchSize ?? 100,
    });

    const changes: Array<{ title: string; from: string; to: string }> = [];
    for (const puzzle of page.page) {
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
    return {
      dryRun,
      scanned: page.page.length,
      moved: changes.length,
      changes,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
