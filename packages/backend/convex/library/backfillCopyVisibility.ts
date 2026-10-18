import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

// Rows per batch. Each row is one read plus at most one patch, so 100 rows stay far below Convex's
// per-mutation document-read and write limits — the same budget notifications/backfillRefs uses.
export const BACKFILL_COPY_VISIBILITY_BATCH = 100;

type Counts = {
  scanned: number;
  patched: number;
  skipped: number;
  // Of `patched`: unmarked rows whose stored value was "private" (the old domain default).
  wasPrivate: number;
};

// One-shot, idempotent migration to the per-copy visibility toggle: every `ownedPuzzles` row
// WITHOUT `visibilityAuthoritative` gets `visibility: "visible"` + `visibilityAuthoritative: true`,
// so nothing changes for anyone (library/copyVisibility already reads such rows as visible). Rows
// that already carry the marker — written by the domain repository, i.e. possibly an owner's
// deliberate "private" — are skipped, never overwritten. Pages through the table and reschedules
// itself until it is exhausted; each batch is its own transaction. Only `visibility` and
// `visibilityAuthoritative` are written (not `updatedAt`: this is not an owner edit). `dryRun`
// walks every page and counts without writing. Runbook: docs/deployment/one-shot-migrations.md.
export const backfillCopyVisibility = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        patched: v.number(),
        skipped: v.number(),
        wasPrivate: v.number(),
      }),
    ),
  },
  handler: async (ctx, { cursor, dryRun, totals }): Promise<Counts> => {
    const page = await ctx.db.query("ownedPuzzles").paginate({
      numItems: BACKFILL_COPY_VISIBILITY_BATCH,
      cursor: cursor ?? null,
    });

    const batch: Counts = { scanned: 0, patched: 0, skipped: 0, wasPrivate: 0 };
    for (const row of page.page) {
      batch.scanned++;
      if (row.visibilityAuthoritative === true) {
        batch.skipped++;
        continue;
      }
      if (row.visibility === "private") batch.wasPrivate++;
      if (!dryRun) {
        await ctx.db.patch(row._id, {
          visibility: "visible",
          visibilityAuthoritative: true,
        });
      }
      batch.patched++;
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      patched: (totals?.patched ?? 0) + batch.patched,
      skipped: (totals?.skipped ?? 0) + batch.skipped,
      wasPrivate: (totals?.wasPrivate ?? 0) + batch.wasPrivate,
    };
    console.log(
      `library/backfillCopyVisibility${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.backfillCopyVisibility.backfillCopyVisibility,
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
