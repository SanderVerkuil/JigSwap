"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalAction, type ActionCtx } from "../../_generated/server";
import { ingestToAxiom } from "../axiom";
import { logEvent, type WideEvent } from "../logEvent";
import {
  encodeRenditions,
  RENDITION_WIDTHS,
  type RenditionSet,
} from "./renditionEncode";

// Make and store the renditions of an image blob (PERF-C1, P-42): its 480 and 960 px WebP
// copies (lib/imageModeration/renditionEncode), recorded against the source blob in
// `imageRenditions` (lib/imageModeration/renditionsStore, which also holds the invariants).
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

const SLOT_BY_WIDTH = new Map<number, "small" | "medium">([
  [RENDITION_WIDTHS[0], "small"],
  [RENDITION_WIDTHS[1], "medium"],
]);

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
  if (!job.eligible) return "not_eligible";
  if (job.done) return "already_done";

  const bytes = await io("download", async () => {
    const blob = await ctx.storage.get(sourceId);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  });
  if (!bytes) return "source_missing";
  event.source_bytes = bytes.byteLength;

  let set: RenditionSet;
  try {
    set = await encodeRenditions(bytes);
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

  const slots: { small?: Slot; medium?: Slot } = {};
  try {
    for (const rendition of set.renditions) {
      const name = SLOT_BY_WIDTH.get(rendition.width);
      if (!name) continue;
      const fileId = await io("store", () =>
        ctx.storage.store(
          new Blob([rendition.bytes as BlobPart], { type: "image/webp" }),
        ),
      );
      slots[name] = {
        fileId,
        width: rendition.width,
        height: rendition.height,
      };
      event[`${name}_bytes`] = rendition.bytes.byteLength;
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
    const fileIds = [slots.small, slots.medium].flatMap((slot) =>
      slot ? [slot.fileId] : [],
    );
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

// One source, with its wide event. A transient failure is retried later (renditionRetryDelayMs).
const renderAndLog = async (
  ctx: ActionCtx,
  sourceId: Id<"_storage">,
  attempt: number,
): Promise<RenditionResult> => {
  const startedAt = Date.now();
  const event: WideEvent = {
    event: "imageModeration.renditions",
    outcome: "success",
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
      error instanceof TransientError ? renditionRetryDelayMs(attempt) : null;
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
    renderAndLog(ctx, sourceId, attempt ?? 1),
});
