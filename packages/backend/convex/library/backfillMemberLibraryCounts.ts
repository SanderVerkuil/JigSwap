import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { scanMemberLibraryCounts } from "./memberLibraryCounts";

// Members per batch. Each one reads their copies (at most LIBRARY_COUNT_SCAN_CAP) in this
// transaction, which is what keeps a count exact: a copy written meanwhile conflicts and the batch
// retries. `batchSize` overrides it, floored and clamped to 1..MAX.
export const BACKFILL_LIBRARY_COUNTS_BATCH = 20;
export const BACKFILL_LIBRARY_COUNTS_MAX_BATCH = 100;

type Counts = {
  scanned: number;
  // Members without a row who got one.
  set: number;
  // Members whose row disagreed with their copies and was corrected.
  repaired: number;
  inStep: number;
  // Members with no copies and no row. They need no row: their count reads no rows either.
  empty: number;
  // Members past the scan cap, left without a row: their count stays a bounded scan.
  overCap: number;
};

// One-shot, idempotent backfill of `memberLibraryCounts` (PERF-B5q). Pages through `users` and
// reschedules itself until it is exhausted; each batch is its own transaction. Per member it counts
// their copies and writes the row when it is absent or disagrees, so a re-run writes nothing and
// doubles as a repair of any row a write path let drift. `dryRun` walks every page and counts
// without writing. Until it has run, library/memberLibraryCounts.readMemberLibraryCounts counts the
// library itself, so nobody sees a wrong number, only the old cost; a member's first copy write also
// creates their row. Runbook: docs/deployment/one-shot-migrations.md.
export const backfillMemberLibraryCounts = internalMutation({
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
        empty: v.number(),
        overCap: v.number(),
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
        BACKFILL_LIBRARY_COUNTS_MAX_BATCH,
        Math.floor(batchSize ?? BACKFILL_LIBRARY_COUNTS_BATCH),
      ),
    );
    const page = await ctx.db
      .query("users")
      .paginate({ numItems, cursor: cursor ?? null });

    const batch: Counts = {
      scanned: 0,
      set: 0,
      repaired: 0,
      inStep: 0,
      empty: 0,
      overCap: 0,
    };
    for (const user of page.page) {
      batch.scanned++;
      const scan = await scanMemberLibraryCounts(ctx, user._id);
      const row = await ctx.db
        .query("memberLibraryCounts")
        .withIndex("by_member", (q) => q.eq("memberId", user._id))
        .unique();
      if (!scan.complete) {
        batch.overCap++;
        if (row && !dryRun) await ctx.db.delete(row._id);
        continue;
      }
      if (!row) {
        if (scan.owned === 0) {
          batch.empty++;
          continue;
        }
        batch.set++;
        if (!dryRun) {
          await ctx.db.insert("memberLibraryCounts", {
            memberId: user._id,
            owned: scan.owned,
            forTrade: scan.forTrade,
          });
        }
        continue;
      }
      if (row.owned === scan.owned && row.forTrade === scan.forTrade) {
        batch.inStep++;
        continue;
      }
      batch.repaired++;
      if (!dryRun) {
        await ctx.db.patch(row._id, {
          owned: scan.owned,
          forTrade: scan.forTrade,
        });
      }
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      set: (totals?.set ?? 0) + batch.set,
      repaired: (totals?.repaired ?? 0) + batch.repaired,
      inStep: (totals?.inStep ?? 0) + batch.inStep,
      empty: (totals?.empty ?? 0) + batch.empty,
      overCap: (totals?.overCap ?? 0) + batch.overCap,
    };
    logEvent({
      event: "library.backfillMemberLibraryCounts",
      outcome: "success",
      dry_run: dryRun ?? false,
      batch,
      totals: runTotals,
      is_done: page.isDone,
    });

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.backfillMemberLibraryCounts
          .backfillMemberLibraryCounts,
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
