import { puzzleSearchableText } from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

// Rows per batch. Each row is one read plus at most one patch.
export const BACKFILL_SEARCHABLE_TEXT_BATCH = 100;

type Counts = { scanned: number; patched: number };

// One-shot, idempotent: recomputes every puzzle's searchableText with the projection the aggregate
// now saves (accents folded, so "cafe" finds "Café"). Until a row is reached it keeps matching its
// accented spelling (puzzleSearchTerm asks for both). Pages through the table and reschedules itself
// until it is exhausted; each batch is its own transaction. Only searchableText is written (not
// `updatedAt`: this is not a content edit, and it would shift sitemap <lastmod>). `dryRun` walks
// every page and counts without writing. Runbook: docs/deployment/one-shot-migrations.md.
export const backfillSearchableText = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(v.object({ scanned: v.number(), patched: v.number() })),
  },
  handler: async (ctx, { cursor, dryRun, totals }): Promise<Counts> => {
    const page = await ctx.db.query("puzzles").paginate({
      numItems: BACKFILL_SEARCHABLE_TEXT_BATCH,
      cursor: cursor ?? null,
    });

    const batch: Counts = { scanned: 0, patched: 0 };
    for (const puzzle of page.page) {
      batch.scanned++;
      const searchableText = puzzleSearchableText(puzzle);
      if (puzzle.searchableText === searchableText) continue;
      if (!dryRun) await ctx.db.patch(puzzle._id, { searchableText });
      batch.patched++;
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      patched: (totals?.patched ?? 0) + batch.patched,
    };
    console.log(
      `catalog/backfillSearchableText${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.catalog.backfillSearchableText.backfillSearchableText,
        {
          cursor: page.continueCursor,
          totals: runTotals,
          ...(dryRun ? { dryRun } : {}),
        },
      );
    }
    return batch;
  },
});
