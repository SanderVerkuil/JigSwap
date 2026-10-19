"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  checkAllHashes,
  makeCsamHashCheckPortFromEnv,
  readCsamHashCheckConfig,
} from "../lib/imageModeration/csamHashCheck";
import {
  hashImageBytes,
  preserveAndQuarantine,
} from "../lib/imageModeration/pipeline";
import type { RescreenCandidate } from "../lib/imageModeration/rescreenStore";
import { logEvent, type WideEvent } from "../lib/logEvent";
import {
  makeModerationPortFromEnv,
  readScreeningConfig,
} from "./adapters/photoModeration";

// One-shot RE-SCREEN of existing images that were never actually checked by the content
// classifier: rows "unscored", or approved WITHOUT a classifier score (legacy, provider "none",
// or the pre-fix pipeline that approved every photo when the Hugging Face call failed), and
// images that have no moderation row at all. See needsRescreen. Runbook:
// docs/deployment/one-shot-migrations.md.
//
// - `table`: run each.
//   - "copy": ownedPuzzleImages;
//   - "completion": completionImages sidecars;
//   - "completionLegacy": completion photos without a sidecar (stored before sidecars existed);
//     a sidecar is created for one that gets a verdict;
//   - "boxArt": puzzles.image; "proposals": puzzleChangeProposals.changes.image. Box art without
//     a boxArtUploads listing (stored before the listing existed) gets one when it gets a
//     verdict (lib/imageModeration/rescreenStore).
// - `dryRun` defaults to TRUE: it counts candidates only — no classifier or hash-service calls,
//   no writes. A real run (`dryRun: false`) refuses to start unless the classifier is configured.
// - Paginated + rate-limited: `batchSize` rows per run (default 10), classified one at a time,
//   then the action re-schedules itself after `delayMs` (default 10 s) with the next cursor.
// - Only a SCORED result is written (applyRescreenVerdict: approved / rejected, where rejected has
//   the live pipeline's side effects: hidden, audit stamp; a completion photo is also detached +
//   deleted, box art detached from every definition and proposal + deleted).
//   An unscored result leaves the row exactly as it was, so a provider hiccup never hides a legacy
//   photo.
// - Stops the whole run on a configuration problem (missing token, auth, unknown model): nothing
//   would succeed. Rate limits / 5xx / network errors back off and retry the SAME page, up to
//   MAX_BACKOFFS times in a row.
// Re-runnable: rows decided by a previous run carry a score and are no longer candidates.

export const RESCREEN_DEFAULT_BATCH = 10;
export const RESCREEN_DEFAULT_DELAY_MS = 10_000;
export const RESCREEN_MAX_BACKOFFS = 5;

const totalsValidator = v.object({
  scanned: v.number(),
  candidates: v.number(),
  approved: v.number(),
  rejected: v.number(),
  unscored: v.number(),
  skipped: v.number(),
  // CSAM hash matches found by the re-screen (quarantined, never classified).
  quarantined: v.optional(v.number()),
});
type Totals = typeof totalsValidator.type;

const ZERO: Totals = {
  scanned: 0,
  candidates: 0,
  approved: 0,
  rejected: 0,
  unscored: 0,
  skipped: 0,
  quarantined: 0,
};

const addTotals = (a: Totals, b: Totals): Totals => ({
  scanned: a.scanned + b.scanned,
  candidates: a.candidates + b.candidates,
  approved: a.approved + b.approved,
  rejected: a.rejected + b.rejected,
  unscored: a.unscored + b.unscored,
  skipped: a.skipped + b.skipped,
  quarantined: (a.quarantined ?? 0) + (b.quarantined ?? 0),
});

const tableValidator = v.union(
  v.literal("copy"),
  v.literal("completion"),
  v.literal("completionLegacy"),
  v.literal("boxArt"),
  v.literal("proposals"),
);
type Table = typeof tableValidator.type;

type Page = {
  scanned: number;
  candidates: RescreenCandidate[];
  isDone: boolean;
  continueCursor: string;
};

const loadPage = async (
  ctx: ActionCtx,
  table: Table,
  cursor: string | null,
  numItems: number,
): Promise<Page> => {
  const paginationOpts = { numItems, cursor };
  if (table === "boxArt" || table === "proposals") {
    return ctx.runQuery(
      internal.lib.imageModeration.rescreenStore.listBoxArtCandidates,
      { table, paginationOpts },
    );
  }
  if (table === "completionLegacy") {
    return ctx.runQuery(
      internal.lib.imageModeration.rescreenStore.listLegacyCompletionCandidates,
      { paginationOpts },
    );
  }
  const page =
    table === "copy"
      ? await ctx.runQuery(
          internal.library.moderationStore.listRescreenCandidates,
          { paginationOpts },
        )
      : await ctx.runQuery(
          internal.solving.completionModerationStore.listRescreenCandidates,
          { paginationOpts },
        );
  return {
    ...page,
    candidates: page.candidates.map((c) => ({ ...c, ref: c.imageId })),
  };
};

// The candidate's moderation row, created when it has none (legacy box art, a legacy
// completion photo), so the verdict or the quarantine step has a row to act on.
const ensureRow = async (
  ctx: ActionCtx,
  table: Table,
  candidate: RescreenCandidate,
): Promise<string> => {
  if (candidate.imageId) return candidate.imageId;
  if (table === "completionLegacy") {
    return ctx.runMutation(
      internal.lib.imageModeration.rescreenStore.ensureLegacyCompletionSidecar,
      {
        completionId: candidate.ref,
        fileId: candidate.fileId,
        uploaderId: candidate.uploaderId,
      },
    );
  }
  return ctx.runMutation(
    internal.lib.imageModeration.backfillBoxArtHashCheckStore
      .listingForQuarantine,
    { storageId: candidate.fileId, uploaderId: candidate.uploaderId },
  );
};

const quarantineStep = (table: Table) =>
  table === "copy"
    ? internal.library.moderationStore.quarantineImage
    : table === "completion" || table === "completionLegacy"
      ? internal.solving.completionModerationStore.quarantineImage
      : internal.catalog.boxArtModerationStore.quarantine;

const applyVerdict = async (
  ctx: ActionCtx,
  table: Table,
  candidate: RescreenCandidate,
  verdict: {
    moderationStatus: "approved" | "rejected";
    moderationScore: number;
    moderationLabel?: string;
  },
): Promise<boolean> => {
  const imageId = await ensureRow(ctx, table, candidate);
  if (table === "copy") {
    return ctx.runMutation(
      internal.library.moderationStore.applyRescreenVerdict,
      { imageId: imageId as Id<"ownedPuzzleImages">, ...verdict },
    );
  }
  if (table === "completion" || table === "completionLegacy") {
    return ctx.runMutation(
      internal.solving.completionModerationStore.applyRescreenVerdict,
      { imageId: imageId as Id<"completionImages">, ...verdict },
    );
  }
  return ctx.runMutation(
    internal.catalog.boxArtModerationStore.applyRescreenVerdict,
    { imageId: imageId as Id<"boxArtUploads">, ...verdict },
  );
};

export const rescreenPhotos = internalAction({
  args: {
    table: tableValidator,
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
    backoffs: v.optional(v.number()),
    totals: v.optional(totalsValidator),
  },
  handler: async (ctx, args): Promise<Totals> => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.max(
      1,
      Math.min(100, args.batchSize ?? RESCREEN_DEFAULT_BATCH),
    );
    const delayMs = Math.max(0, args.delayMs ?? RESCREEN_DEFAULT_DELAY_MS);
    const config = readScreeningConfig(process.env);
    const event: WideEvent = {
      event: "library.rescreenPhotos",
      outcome: "success",
      table: args.table,
      dry_run: dryRun,
      batch_size: batchSize,
      screening_config: config.status,
      model: config.model,
    };

    // Re-schedule this action with the same knobs.
    const next = (
      cursor: string | null,
      totals: Totals,
      backoffs: number,
      after: number,
    ) =>
      ctx.scheduler.runAfter(
        after,
        internal.library.rescreenPhotos.rescreenPhotos,
        {
          table: args.table,
          cursor,
          totals,
          backoffs,
          batchSize,
          delayMs,
          dryRun,
        },
      );

    if (!dryRun && config.status !== "ok") {
      // Nothing can be scored: refuse up front instead of burning through the table.
      event.outcome = "error";
      event.result = "aborted_config";
      logEvent(event);
      return ZERO;
    }

    const page = await loadPage(
      ctx,
      args.table,
      args.cursor ?? null,
      batchSize,
    );
    const batch: Totals = {
      ...ZERO,
      scanned: page.scanned,
      candidates: page.candidates.length,
    };

    let stop: "config" | "backoff" | null = null;
    if (!dryRun) {
      const port = makeModerationPortFromEnv(process.env);
      // Legacy and unscored photos never went through the CSAM hash check: check them first.
      const hashPort = makeCsamHashCheckPortFromEnv(process.env);
      const hashProvider = readCsamHashCheckConfig(process.env).provider;
      const quarantine = quarantineStep(args.table);

      for (const candidate of page.candidates) {
        const blob = await ctx.storage.get(candidate.fileId);
        if (!blob) {
          batch.skipped++;
          continue;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // Hash check BEFORE classifying. A match quarantines (re-stored as a new blob, always
        // escalated, never classified). Unavailable is counted and the row is classified anyway:
        // these photos are already published, and holding them back is the live pipeline's job.
        const hashCheck = await checkAllHashes(hashPort, [
          hashImageBytes(bytes),
        ]);
        if (hashCheck.status === "match" && hashCheck.matched) {
          await preserveAndQuarantine(
            ctx,
            quarantine,
            { event: "library.rescreenPhotos.match", outcome: "success" },
            {
              imageId: await ensureRow(ctx, args.table, candidate),
              bytes,
              uploadedFileId: candidate.fileId,
              uploaderId: candidate.uploaderId,
              matched: hashCheck.matched,
              provider: hashProvider,
              originalDiscarded: false,
            },
          );
          batch.quarantined = (batch.quarantined ?? 0) + 1;
          continue;
        }
        // no_match is not recorded: these rows predate the publication gate and stay served.
        if (hashCheck.status === "unavailable") {
          event.hash_check_unavailable =
            ((event.hash_check_unavailable as number | undefined) ?? 0) + 1;
        }
        const result = await port.classify(bytes, blob.type || undefined);
        if (result.status === "unscored") {
          batch.unscored++;
          event.last_unscored_reason = result.reason;
          event.last_http_status = result.httpStatus;
          if (
            result.reason === "missing_token" ||
            result.reason === "auth" ||
            result.reason === "model_unavailable"
          ) {
            stop = "config";
            break;
          }
          if (result.retryable) {
            stop = "backoff";
            break;
          }
          continue; // e.g. bad_response for this one image: leave it, move on.
        }
        if (result.score === null) {
          batch.skipped++; // provider "none": nothing scored.
          continue;
        }
        const patched = await applyVerdict(ctx, args.table, candidate, {
          moderationStatus: result.status,
          moderationScore: result.score,
          moderationLabel: result.label ?? undefined,
        });
        if (!patched) batch.skipped++;
        else if (result.status === "rejected") batch.rejected++;
        else batch.approved++;
      }
    }

    const totals = addTotals(args.totals ?? ZERO, batch);
    event.batch = batch;
    event.totals = totals;
    event.is_done = page.isDone;

    if (stop === "config") {
      event.outcome = "error";
      event.result = "aborted_config";
    } else if (stop === "backoff") {
      const backoffs = (args.backoffs ?? 0) + 1;
      if (backoffs > RESCREEN_MAX_BACKOFFS) {
        event.outcome = "error";
        event.result = "aborted_provider_unavailable";
      } else {
        // Retry the SAME page (already-decided rows drop out of it) with exponential backoff.
        event.result = "backoff";
        event.backoffs = backoffs;
        // The page is re-read, so only carry this attempt's writes forward, not its scan counts.
        const carried = addTotals(args.totals ?? ZERO, {
          ...batch,
          scanned: 0,
          candidates: 0,
        });
        await next(
          args.cursor ?? null,
          carried,
          backoffs,
          delayMs * 2 ** backoffs,
        );
      }
    } else if (!page.isDone) {
      await next(page.continueCursor, totals, 0, dryRun ? 0 : delayMs);
    } else {
      event.result = "done";
    }
    logEvent(event);
    return batch;
  },
});
