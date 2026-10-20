import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { settleSendBatch } from "./messageAttachments";

/** Attachment rows without a message read per batch. */
export const BACKFILL_HELD_PHOTOS_BATCH = 50;

type Counts = {
  rowsScanned: number;
  batchesSettled: number;
  photosAppended: number;
};

// The append-at-send transition (spec 2026-10-20 D8), one-off. Before it, a sent photo was held
// (`sendRequestedAt` set, no `messageId`) until its check finished, and a photo stuck before its
// re-encode held the rest of its batch forever. The new settle appends every held photo the check
// has not stopped at the batch's next state change; this run settles the batches that will never
// see one. Each batch's photos become image messages now (the run's time: the domain clock can't
// backdate them), and their recipients see "Pending review" until each may be served. A blocked
// pair's held photos are dropped instead, as the settle does.
//
// `dryRun` DEFAULTS TO TRUE: it only counts (rows scanned, held batches, photos that would be
// appended). Run with `dryRun: false` once after deploy. Pages `messageAttachments` rows without a
// message (`by_message`) and reschedules itself until done; idempotent.
export const backfillHeldPhotos = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    totals: v.optional(
      v.object({
        rowsScanned: v.number(),
        batchesSettled: v.number(),
        photosAppended: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Counts> => {
    const dryRun = args.dryRun ?? true;
    const page = await ctx.db
      .query("messageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", undefined))
      .paginate({
        numItems: args.batchSize ?? BACKFILL_HELD_PHOTOS_BATCH,
        cursor: args.cursor ?? null,
      });

    const counts: Counts = {
      rowsScanned: 0,
      batchesSettled: 0,
      photosAppended: 0,
    };
    const seen = new Set<string>();
    for (const row of page.page) {
      counts.rowsScanned++;
      if (row.kind !== "image" || row.sendRequestedAt === undefined) continue;
      const stopped =
        row.moderationStatus === "rejected" ||
        row.moderationStatus === "quarantined" ||
        row.moderationStatus === "removed";
      if (!stopped) counts.photosAppended++;
      const key = `${row.threadAggregateId}:${row.uploaderId}:${row.sendRequestedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.batchesSettled++;
      if (!dryRun) await settleSendBatch(ctx, row._id);
    }

    const totals: Counts = {
      rowsScanned: (args.totals?.rowsScanned ?? 0) + counts.rowsScanned,
      batchesSettled:
        (args.totals?.batchesSettled ?? 0) + counts.batchesSettled,
      photosAppended:
        (args.totals?.photosAppended ?? 0) + counts.photosAppended,
    };
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.conversation.backfillHeldPhotos.backfillHeldPhotos,
        {
          dryRun,
          cursor: page.continueCursor,
          batchSize: args.batchSize,
          totals,
        },
      );
    } else {
      logEvent({
        event: "conversation.backfillHeldPhotos",
        outcome: "success",
        dry_run: dryRun,
        rows_scanned: totals.rowsScanned,
        batches_settled: totals.batchesSettled,
        photos_appended: totals.photosAppended,
      });
    }
    return counts;
  },
});
