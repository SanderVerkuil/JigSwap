import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

// Shares per batch. Each costs one copy point read, the copy's custody entries after the share
// (one per transfer, a handful at most) and, only for a share that looks stale, a BOUNDED scan of
// later CopySharedToCircle events (RESHARE_SCAN_CAP rows). Worst case ~25 * 500 reads per batch,
// well inside Convex's per-transaction read limits. `batchSize` overrides it (1..100).
export const BACKFILL_STALE_CIRCLE_SHARES_BATCH = 25;

// Most CopySharedToCircle events read when looking for a re-share by the current owner. Past the
// cap the share is left alone and counted `undetermined` (never deleted on a guess).
export const RESHARE_SCAN_CAP = 500;

type Counts = {
  scanned: number;
  stale: number;
  dangling: number;
  kept: number;
  undetermined: number;
};

type Verdict = "stale" | "dangling" | "kept" | "undetermined";

// The share row stores no sharer, so it is derived: shareCopyToCircle only lets the copy's OWNER
// share, so the sharer is whoever owned the copy at `sharedAt`. Ownership only changes through
// exchange settlement, and the custody subscriber records each change (previous + new owner) in
// `copyCustodyEntries`, keyed by the copy's `_id`. So:
// - no copy row -> dangling (the copy was deleted; the link points at nothing).
// - no transfer after `sharedAt` -> the sharer still owns it -> kept.
// - the first transfer after `sharedAt` names the sharer as its previousOwner; if the copy's
//   current owner IS that sharer (it came back) -> kept.
// - the current owner re-shared it into this circle after the last transfer (the projection is
//   idempotent, so the old row and its old `sharedAt` stayed) -> kept.
// - otherwise the current owner never shared it into this circle -> stale.
const judge = async (
  ctx: MutationCtx,
  share: Doc<"circleCopyShares">,
): Promise<Verdict> => {
  const copy = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", share.copyId))
    .unique();
  if (!copy) return "dangling";

  const transfers = await ctx.db
    .query("copyCustodyEntries")
    .withIndex("by_copy", (q) =>
      q.eq("copyId", copy._id as string).gt("occurredAt", share.sharedAt),
    )
    .collect();
  if (transfers.length === 0) return "kept";
  if (transfers[0].previousOwner === (copy.ownerId as string)) return "kept";

  const lastTransferAt = transfers[transfers.length - 1].occurredAt;
  const laterShares = await ctx.db
    .query("domainEvents")
    .withIndex("by_name", (q) =>
      q.eq("name", "CopySharedToCircle").gte("occurredAt", lastTransferAt),
    )
    .take(RESHARE_SCAN_CAP);
  const reshared = laterShares.some((e) => {
    const p = e.payload as Record<string, unknown>;
    return p.circleId === share.circleId && p.copyId === share.copyId;
  });
  if (reshared) return "kept";
  if (laterShares.length === RESHARE_SCAN_CAP) return "undetermined";
  return "stale";
};

// One-shot, idempotent cleanup of `circleCopyShares` rows left behind by ownership transfers before
// #184 (which now deletes a copy's shares on CopyOwnershipTransferred). Pages through
// `circleCopyShares`, rescheduling itself until the table is exhausted; each batch is its own
// transaction. Deletes a share only when the custody chain shows the copy's current owner is not
// the member who shared it (`stale`), or when its copy no longer exists (`dangling`). Everything
// else is kept. Re-running deletes nothing new. `dryRun` walks every page and counts without
// deleting.
export const backfillStaleCircleShares = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        stale: v.number(),
        dangling: v.number(),
        kept: v.number(),
        undetermined: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    { cursor, dryRun, batchSize, totals },
  ): Promise<Counts> => {
    const numItems = Math.max(
      1,
      Math.min(100, batchSize ?? BACKFILL_STALE_CIRCLE_SHARES_BATCH),
    );
    const page = await ctx.db
      .query("circleCopyShares")
      .paginate({ numItems, cursor: cursor ?? null });

    const batch: Counts = {
      scanned: 0,
      stale: 0,
      dangling: 0,
      kept: 0,
      undetermined: 0,
    };
    for (const share of page.page) {
      batch.scanned++;
      const verdict = await judge(ctx, share);
      batch[verdict]++;
      if (!dryRun && (verdict === "stale" || verdict === "dangling")) {
        await ctx.db.delete(share._id);
      }
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      stale: (totals?.stale ?? 0) + batch.stale,
      dangling: (totals?.dangling ?? 0) + batch.dangling,
      kept: (totals?.kept ?? 0) + batch.kept,
      undetermined: (totals?.undetermined ?? 0) + batch.undetermined,
    };
    console.log(
      `sharing/backfillStaleCircleShares${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.sharing.backfillStaleCircleShares.backfillStaleCircleShares,
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
