import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { isOpenAvailability } from "./openListing";

// Rows per batch. Each row is one read plus at most one patch. `batchSize` overrides it, floored and
// clamped to 1..MAX, which stays far below Convex's per-mutation read and write limits.
export const BACKFILL_COPY_OPEN_FLAG_BATCH = 200;
export const BACKFILL_COPY_OPEN_FLAG_MAX_BATCH = 1000;

type Counts = {
  scanned: number;
  // Rows without the flag (written before it existed) that got one.
  set: number;
  // Rows whose flag disagreed with their availability and was corrected.
  repaired: number;
  inStep: number;
};

// One-shot, idempotent backfill of the `ownedPuzzles.isOpen` listing flag (PERF-B1m, SEC-29). Pages
// through the table and reschedules itself until it is exhausted; each batch is its own transaction.
// Per row it writes `isOpen` = isOpenAvailability(availability) when the flag is absent or disagrees.
// It writes only `isOpen` (not `updatedAt`: this is not an owner edit), so a re-run writes nothing.
// `dryRun` walks every page and counts without writing. A re-run also repairs any row a write path
// changed without keeping the flag in step (`repaired` counts them). Until it has run, Browse finds
// legacy open copies through the absent-flag range in library/openListing.openListingWindow, at
// the old full-scan cost. Runbook: docs/deployment/one-shot-migrations.md.
export const backfillCopyOpenFlag = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        set: v.number(),
        repaired: v.number(),
        inStep: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    { cursor, dryRun, batchSize, totals },
  ): Promise<Counts> => {
    const numItems = Math.max(
      1,
      Math.min(
        BACKFILL_COPY_OPEN_FLAG_MAX_BATCH,
        Math.floor(batchSize ?? BACKFILL_COPY_OPEN_FLAG_BATCH),
      ),
    );
    const page = await ctx.db
      .query("ownedPuzzles")
      .paginate({ numItems, cursor: cursor ?? null });

    const batch: Counts = { scanned: 0, set: 0, repaired: 0, inStep: 0 };
    for (const row of page.page) {
      batch.scanned++;
      const isOpen = isOpenAvailability(row.availability);
      if (row.isOpen === isOpen) {
        batch.inStep++;
        continue;
      }
      if (row.isOpen === undefined) batch.set++;
      else batch.repaired++;
      if (!dryRun) await ctx.db.patch(row._id, { isOpen });
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      set: (totals?.set ?? 0) + batch.set,
      repaired: (totals?.repaired ?? 0) + batch.repaired,
      inStep: (totals?.inStep ?? 0) + batch.inStep,
    };
    logEvent({
      event: "library.backfillCopyOpenFlag",
      outcome: "success",
      dry_run: dryRun ?? false,
      batch,
      totals: runTotals,
      is_done: page.isDone,
    });

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.backfillCopyOpenFlag.backfillCopyOpenFlag,
        {
          cursor: page.continueCursor,
          totals: runTotals,
          ...(batchSize !== undefined ? { batchSize } : {}),
          ...(dryRun ? { dryRun } : {}),
        },
      );
    }
    return batch;
  },
});
