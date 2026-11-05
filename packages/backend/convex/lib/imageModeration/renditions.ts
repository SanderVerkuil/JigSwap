"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalAction, type ActionCtx } from "../../_generated/server";
import { ingestToAxiom } from "../axiom";
import { logEvent, type WideEvent } from "../logEvent";
import {
  encodeRenditions,
  MESSAGE_THUMB_LADDER,
  RENDITION_LADDER,
  THUMBNAIL_LADDER,
  type RenditionLadder,
  type RenditionSet,
  type RenditionSlot,
} from "./renditionEncode";
import {
  backfillTotalsValidator,
  NO_TOTALS,
  renditionTableValidator,
  type BackfillTotals,
  type RenditionKind,
} from "./renditionsStore";

// Make and store the renditions of an image blob (PERF-C1, P-42): its smaller WebP copies
// (lib/imageModeration/renditionEncode; which sizes depends on what the image is, LADDERS),
// recorded against the source blob in `imageRenditions`, or on its row for a message photo
// (lib/imageModeration/renditionsStore, which also holds the invariants).
//
// generateRenditions: one source, scheduled once an image may be shown (scheduleRenditions).
// Checks the source is eligible and has none yet, downloads it, encodes, stores each rendition
// as "image/webp" and records them; a source that changed meanwhile keeps nothing (its new
// blobs are deleted). It runs on its own, outside the moderation Workpool, so it never slows a
// check. A storage or database failure is retried with backoff (RENDITION_MAX_ATTEMPTS in all);
// bytes the guards refuse, that do not decode, or that the encoder fails on finish without a
// retry (the source is served as it is). Each run emits ONE wide event
// ("imageModeration.renditions": ids, sizes in px and bytes, timing; never image data) to the
// logs and Axiom.
//
// backfillRenditions: the one-shot for images stored before renditions existed, per `table`:
// "boxArt" (the default: every definition's box art), "copy" (copy photos), "completion"
// (completion photos), "circleIcon" (circle icons) or "message" (message photos). `dryRun`
// defaults to TRUE: it only counts. Pass `dryRun: false` to write. Paginated: `batchSize`
// rows per run (default 10), their candidates made ONE AFTER ANOTHER in the same action
// (one decoded image in memory at a time); the action re-schedules itself with the next cursor
// and logs the running totals ("imageModeration.backfillRenditions") on every page and the
// final ones with `done: true`. Create-only (it never deletes a stored image) and idempotent: a
// source that has its renditions is no longer a candidate, so a re-run picks up only what
// failed.

// Which sizes each kind of image gets. Box art and copy photos appear on cards of many widths; a
// completion photo is only ever a small tile (the viewer opens the original), a circle icon a
// small avatar and a message photo a thread tile of at most 288 px.
const LADDERS: Record<RenditionKind, RenditionLadder> = {
  boxArt: RENDITION_LADDER,
  copy: RENDITION_LADDER,
  completion: THUMBNAIL_LADDER,
  circleIcon: THUMBNAIL_LADDER,
  message: MESSAGE_THUMB_LADDER,
};

/** Runs per source, the first included, when storage or the database fails. */
export const RENDITION_MAX_ATTEMPTS = 3;

/** The wait before the next attempt (30 s, then 2 min), or null when none is left. */
export const renditionRetryDelayMs = (attempt: number): number | null =>
  attempt < RENDITION_MAX_ATTEMPTS ? 30_000 * 4 ** (attempt - 1) : null;

export type RenditionResult =
  | "recorded"
  | "already_done"
  | "not_eligible"
  | "source_missing"
  | "refused"
  | "discarded"
  | "failed"
  | "retry";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** A storage or database call failed: worth another attempt later. */
class TransientError extends Error {
  constructor(
    readonly stage: string,
    cause: unknown,
  ) {
    super(errMsg(cause));
  }
}

const io = async <T>(stage: string, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    throw new TransientError(stage, error);
  }
};

type Slot = { fileId: Id<"_storage">; width: number; height: number };

// Make, store and record one source's renditions. Throws only a TransientError.
const render = async (
  ctx: ActionCtx,
  sourceId: Id<"_storage">,
  event: WideEvent,
): Promise<Exclude<RenditionResult, "retry">> => {
  const job = await io("job", () =>
    ctx.runQuery(internal.lib.imageModeration.renditionsStore.renditionJob, {
      sourceId,
    }),
  );
  if (job.kind === null) return "not_eligible";
  if (job.done) return "already_done";
  event.source_kind = job.kind;

  const bytes = await io("download", async () => {
    const blob = await ctx.storage.get(sourceId);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  });
  if (!bytes) return "source_missing";
  event.source_bytes = bytes.byteLength;

  let set: RenditionSet;
  try {
    set = await encodeRenditions(bytes, LADDERS[job.kind]);
  } catch (error) {
    event.outcome = "error";
    event.error = { stage: "encode", message: errMsg(error) };
    return "failed";
  }
  if (!set.ok) {
    event.refused_reason = set.reason;
    return "refused";
  }
  event.source_width = set.width;
  event.source_height = set.height;
  if (set.notSmaller.length > 0) event.not_smaller = set.notSmaller;

  const slots: Partial<Record<RenditionSlot, Slot>> = {};
  try {
    for (const rendition of set.renditions) {
      const fileId = await io("store", () =>
        ctx.storage.store(
          new Blob([rendition.bytes as BlobPart], { type: "image/webp" }),
        ),
      );
      slots[rendition.slot] = {
        fileId,
        width: rendition.width,
        height: rendition.height,
      };
      event[`${rendition.slot}_bytes`] = rendition.bytes.byteLength;
    }
    const recorded = await io("record", () =>
      ctx.runMutation(
        internal.lib.imageModeration.renditionsStore.recordRenditions,
        { sourceId, width: set.width, height: set.height, ...slots },
      ),
    );
    return recorded ? "recorded" : "discarded";
  } catch (error) {
    // Nothing holds the blobs stored so far: delete them before giving up on this attempt.
    const fileIds = Object.values(slots).map((slot) => slot.fileId);
    if (fileIds.length > 0) {
      await ctx
        .runMutation(
          internal.lib.imageModeration.renditionsStore.discardUnrecorded,
          { fileIds },
        )
        .catch(() => {
          event.orphaned_blobs = fileIds.length;
        });
    }
    throw error;
  }
};

// One source, with its wide event. A scheduled run retries a transient failure later
// (renditionRetryDelayMs); the backfill counts it as failed instead (a re-run picks it up).
const renderAndLog = async (
  ctx: ActionCtx,
  sourceId: Id<"_storage">,
  { attempt, trigger }: { attempt: number; trigger: "scheduled" | "backfill" },
): Promise<RenditionResult> => {
  const startedAt = Date.now();
  const event: WideEvent = {
    event: "imageModeration.renditions",
    outcome: "success",
    trigger,
    source_id: sourceId,
    attempt,
  };
  let result: RenditionResult = "failed";
  try {
    result = await render(ctx, sourceId, event);
  } catch (error) {
    event.outcome = "error";
    event.error = {
      stage: error instanceof TransientError ? error.stage : "unexpected",
      message: errMsg(error),
    };
    const delay =
      error instanceof TransientError && trigger === "scheduled"
        ? renditionRetryDelayMs(attempt)
        : null;
    if (delay !== null) {
      await ctx.scheduler.runAfter(
        delay,
        internal.lib.imageModeration.renditions.generateRenditions,
        { sourceId, attempt: attempt + 1 },
      );
      event.retry_in_ms = delay;
      result = "retry";
    }
  } finally {
    event.result = result;
    event.duration_ms = Date.now() - startedAt;
    await ingestToAxiom(logEvent(event));
  }
  return result;
};

export const generateRenditions = internalAction({
  args: { sourceId: v.id("_storage"), attempt: v.optional(v.number()) },
  handler: (ctx, { sourceId, attempt }): Promise<RenditionResult> =>
    renderAndLog(ctx, sourceId, {
      attempt: attempt ?? 1,
      trigger: "scheduled",
    }),
});

export const backfillRenditions = internalAction({
  args: {
    table: v.optional(renditionTableValidator),
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    totals: v.optional(backfillTotalsValidator),
  },
  handler: async (ctx, args): Promise<BackfillTotals> => {
    const table = args.table ?? "boxArt";
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.max(1, Math.min(25, args.batchSize ?? 10));
    const page = await ctx.runQuery(
      internal.lib.imageModeration.renditionsStore.listRenditionCandidates,
      {
        table,
        paginationOpts: { numItems: batchSize, cursor: args.cursor ?? null },
      },
    );
    const batch: BackfillTotals = {
      ...NO_TOTALS,
      scanned: page.scanned,
      candidates: page.candidates.length,
    };
    if (!dryRun) {
      for (const sourceId of page.candidates) {
        const result = await renderAndLog(ctx, sourceId, {
          attempt: 1,
          trigger: "backfill",
        });
        if (result === "recorded") batch.recorded += 1;
        else if (result === "refused") batch.refused += 1;
        else if (result === "not_eligible" || result === "already_done") {
          batch.skipped += 1;
        } else batch.failed += 1;
      }
    }

    const prior = args.totals ?? NO_TOTALS;
    const totals: BackfillTotals = {
      scanned: prior.scanned + batch.scanned,
      candidates: prior.candidates + batch.candidates,
      recorded: prior.recorded + batch.recorded,
      refused: prior.refused + batch.refused,
      failed: prior.failed + batch.failed,
      skipped: prior.skipped + batch.skipped,
    };
    logEvent({
      event: "imageModeration.backfillRenditions",
      outcome: "success",
      table,
      dry_run: dryRun,
      done: page.isDone,
      ...totals,
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.renditions.backfillRenditions,
        {
          table,
          dryRun,
          cursor: page.continueCursor,
          batchSize,
          totals,
        },
      );
    }
    return batch;
  },
});
