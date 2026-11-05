import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";

// Rows per batch. Each row is one read plus at most one more read and a patch. `batchSize` overrides
// it, floored and clamped to 1..MAX, which stays far below Convex's per-mutation limits.
export const BACKFILL_CIRCLE_SHARE_OWNERS_BATCH = 200;
export const BACKFILL_CIRCLE_SHARE_OWNERS_MAX_BATCH = 1000;

type Counts = {
  scanned: number;
  // Rows without an owner that got their copy's.
  set: number;
  // Rows that already name one.
  inStep: number;
  // Rows without an owner whose copy no longer exists: they stay as they are.
  noCopy: number;
};

// One-shot, idempotent backfill of `circleCopyShares.ownerId` (schema.ts): the copy's owner, because
// only a copy's owner can share it and a transfer deletes the copy's shares. Pages through the table
// and reschedules itself until it is exhausted; each batch is its own transaction. It writes only that
// field, so a re-run writes nothing. `dryRun` walks every page and counts without writing. Until it has
// run, a busy circle's read (adapters/circleCopyShares.sharesOfCircleWithin) reads such rows newest
// first, as it always did, so one member's newest shares can still crowd out another's older ones.
// Runbook: docs/deployment/one-shot-migrations.md.
export const backfillCircleShareOwners = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        set: v.number(),
        inStep: v.number(),
        noCopy: v.number(),
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
        BACKFILL_CIRCLE_SHARE_OWNERS_MAX_BATCH,
        Math.floor(batchSize ?? BACKFILL_CIRCLE_SHARE_OWNERS_BATCH),
      ),
    );
    const page = await ctx.db
      .query("circleCopyShares")
      .paginate({ numItems, cursor: cursor ?? null });

    const batch: Counts = { scanned: 0, set: 0, inStep: 0, noCopy: 0 };
    for (const share of page.page) {
      batch.scanned++;
      if (share.ownerId !== undefined) {
        batch.inStep++;
        continue;
      }
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", share.copyId))
        .unique();
      if (!copy) {
        batch.noCopy++;
        continue;
      }
      batch.set++;
      if (!dryRun) await ctx.db.patch(share._id, { ownerId: copy.ownerId });
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      set: (totals?.set ?? 0) + batch.set,
      inStep: (totals?.inStep ?? 0) + batch.inStep,
      noCopy: (totals?.noCopy ?? 0) + batch.noCopy,
    };
    logEvent({
      event: "sharing.backfillCircleShareOwners",
      outcome: "success",
      dry_run: dryRun ?? false,
      batch,
      totals: runTotals,
      is_done: page.isDone,
    });

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.sharing.backfillCircleShareOwners.backfillCircleShareOwners,
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
