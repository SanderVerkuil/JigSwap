import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  completionSidecarOf,
  insertLegacyCompletionSidecar,
} from "../lib/imageModeration/rescreenStore";
import { logEvent } from "../lib/logEvent";

/** Completions read per batch: each holds at most 5 photos, so one lookup + insert per photo. */
export const BACKFILL_LEGACY_SIDECARS_BATCH = 50;

const totalsValidator = v.object({
  completions: v.number(),
  photos: v.number(),
  created: v.number(),
  existing: v.number(),
  withoutAggregateId: v.number(),
  photosWithoutAggregateId: v.number(),
});

type Totals = typeof totalsValidator.type;

const NO_TOTALS: Totals = {
  completions: 0,
  photos: 0,
  created: 0,
  existing: 0,
  withoutAggregateId: 0,
  photosWithoutAggregateId: 0,
};

// One-off, idempotent (SEC-92). A completion photo stored before the completionImages sidecars
// existed lives only in the completions row's `photos` array, which no index reaches, so
// blobReferenceKinds cannot see it: a claim, a reference-aware delete or the storage sweep would
// treat its blob as unheld. This gives each such photo its sidecar, in the shape the re-screen
// creates (rescreenStore.insertLegacyCompletionSidecar: no status, no hash fields), which every
// reader serves exactly like the photo without one. A photo that already has a sidecar is left
// alone.
//
// A completion without an aggregateId cannot hold a sidecar (completionImages.completionId is the
// aggregate id): its photos are counted (`photosWithoutAggregateId`) and stay invisible to blob
// references. Both counts must be 0 before the storage sweep may delete.
//
// `dryRun` DEFAULTS TO TRUE: it only counts. Pages `completions` and reschedules itself until
// done; every batch logs the running totals, the last one with `done: true`.
// Runbook: docs/deployment/one-shot-migrations.md.
export const backfillLegacyCompletionSidecars = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    totals: v.optional(totalsValidator),
  },
  handler: async (ctx, args): Promise<Totals & { done: boolean }> => {
    const dryRun = args.dryRun ?? true;
    const page = await ctx.db.query("completions").paginate({
      numItems: BACKFILL_LEGACY_SIDECARS_BATCH,
      cursor: args.cursor ?? null,
    });

    const totals: Totals = { ...(args.totals ?? NO_TOTALS) };
    for (const completion of page.page) {
      totals.completions++;
      totals.photos += completion.photos.length;
      const completionId = completion.aggregateId;
      if (!completionId) {
        totals.withoutAggregateId++;
        totals.photosWithoutAggregateId += completion.photos.length;
        continue;
      }
      for (const fileId of completion.photos) {
        if (await completionSidecarOf(ctx, fileId)) {
          totals.existing++;
          continue;
        }
        totals.created++;
        if (!dryRun) {
          await insertLegacyCompletionSidecar(ctx, {
            completionId,
            fileId,
            uploaderId: completion.userId,
          });
        }
      }
    }

    logEvent({
      event: "solving.backfillLegacyCompletionSidecars",
      outcome: "success",
      dry_run: dryRun,
      done: page.isDone,
      completions: totals.completions,
      photos: totals.photos,
      created: totals.created,
      existing: totals.existing,
      without_aggregate_id: totals.withoutAggregateId,
      photos_without_aggregate_id: totals.photosWithoutAggregateId,
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.solving.backfillLegacyCompletionSidecars
          .backfillLegacyCompletionSidecars,
        { dryRun, cursor: page.continueCursor, totals },
      );
    }
    return { ...totals, done: page.isDone };
  },
});
