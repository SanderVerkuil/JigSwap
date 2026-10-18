"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import {
  makeModerationPortFromEnv,
  planModerationStep,
  readScreeningConfig,
  screeningLogFields,
  toArrayBuffer,
  unscoredResult,
  type ModerationResult,
} from "../library/adapters/photoModeration";
import { reencodeImage } from "../library/moderatePhoto";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Async image-moderation pipeline for an uploaded completion photo — a clone of
// `library/moderatePhoto.ts` operating on the `completionImages` sidecar table (see that file for
// the full rationale: jimp-not-sharp, never-fail-open with retries, wide-event logging, env
// knobs). Scheduled (runAfter 0) by `attachCompletionPhotos`, which inserts the sidecar as
// `moderationStatus: "pending"`. This action:
//   1. (first attempt only) Re-encodes the blob via jimp (drops all EXIF/GPS metadata), then swaps
//      the fileId to the clean blob — in BOTH the sidecar and the completions row's photos array,
//      via `completionModerationStore.setModerationFile` — and deletes the original.
//   2. Classifies the clean bytes via the configured PhotoModerationPort and records the verdict
//      (a rejection also removes the photo from the completion + deletes the blob + stamps).
//
// When the photo cannot be checked it is NOT approved: retryable failures re-schedule this action
// with backoff, otherwise (or once retries run out) the sidecar is stamped "unscored", which keeps
// the photo visible to its uploader only. The action NEVER throws.
export const moderateCompletionPhoto = internalAction({
  // `attempt` is 1-based; absent = the first attempt (the upload's schedule).
  args: { imageId: v.id("completionImages"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt: attemptArg }) => {
    const startedAt = Date.now();
    const attempt = attemptArg ?? 1;
    const config = readScreeningConfig(process.env);
    // ONE canonical wide event per attempt, flushed once in `finally` (see library clone).
    const event: WideEvent = {
      event: "solving.moderateCompletionPhoto",
      outcome: "success",
      image_id: imageId,
      attempt,
      provider: config.provider,
      model: config.provider === "none" ? null : config.model,
      nsfw_threshold: config.threshold,
      screening_config: config.status,
    };
    const flush = async () => {
      event.duration_ms = Date.now() - startedAt;
      const line = logEvent(event);
      await ingestToAxiom(line);
    };

    const finish = async (result: ModerationResult) => {
      Object.assign(event, screeningLogFields(result));
      if (result.status === "unscored") event.outcome = "error";
      const step = planModerationStep(result, attempt);
      if (step.kind === "retry") {
        event.decision = "retry_scheduled";
        event.retry_in_ms = step.delayMs;
        await ctx.scheduler.runAfter(
          step.delayMs,
          internal.solving.moderateCompletionPhoto.moderateCompletionPhoto,
          { imageId, attempt: attempt + 1 },
        );
        return;
      }
      event.decision = result.status;
      await ctx.runMutation(
        internal.solving.completionModerationStore.setModerationVerdict,
        {
          imageId,
          moderationStatus: result.status,
          moderationScore: result.score ?? undefined,
          moderationLabel: result.label ?? undefined,
          moderationReason: result.reason ?? undefined,
          moderationAttempts: attempt,
        },
      );
    };

    try {
      const row = await ctx.runQuery(
        internal.solving.completionModerationStore.getImageForModeration,
        { imageId },
      );
      if (!row) {
        event.result = "skipped_missing";
        return;
      }
      event.completion_id = row.completionId;
      event.uploader_id = row.uploaderId;
      // Already decided (idempotent): a re-run on a decided row is a no-op.
      if (row.moderationStatus !== "pending") {
        event.result = "skipped_not_pending";
        event.prior_status = row.moderationStatus ?? null;
        return;
      }

      let bytes: Uint8Array;
      let mime: string | undefined;
      try {
        const blob = await ctx.storage.get(row.fileId);
        if (!blob) {
          event.error = { stage: "download", message: "storage blob missing" };
          await finish(unscoredResult("missing_file", false));
          return;
        }
        bytes = new Uint8Array(await blob.arrayBuffer());
        mime = blob.type || undefined;
        event.original_bytes = bytes.length;
      } catch (error) {
        event.error = { stage: "download", message: errMsg(error) };
        await finish(unscoredResult("download_error", true));
        return;
      }

      // Re-encode (strip EXIF/metadata) on the first attempt only. Best-effort: on decode failure,
      // classify the original — no file swap happens on that path.
      let cleanBytes = bytes;
      if (attempt === 1) {
        // Tracks the just-stored clean blob across the try/catch. If `setModerationFile` throws
        // AFTER the store succeeded, the row still points at the original, so the clean blob is
        // unreferenced. There is no storage GC, so delete it ourselves to avoid orphaning it.
        let storedFileId: string | null = null;
        try {
          const { bytes: encoded, mime: encodedMime } =
            await reencodeImage(bytes);
          cleanBytes = encoded;
          mime = encodedMime;
          event.reencoded = true;
          event.reencoded_mime = encodedMime;
          event.reencoded_bytes = encoded.length;
          const newFileId = await ctx.storage.store(
            new Blob([toArrayBuffer(cleanBytes)], { type: encodedMime }),
          );
          storedFileId = newFileId;
          await ctx.runMutation(
            internal.solving.completionModerationStore.setModerationFile,
            { imageId, fileId: newFileId },
          );
          // Swap succeeded: the sidecar + completions row now point at the clean blob; drop the
          // original instead (best-effort).
          storedFileId = null;
          try {
            await ctx.storage.delete(row.fileId);
          } catch (error) {
            event.delete_original_error = errMsg(error);
          }
        } catch (error) {
          event.reencoded = false;
          event.reencode_error = errMsg(error);
          cleanBytes = bytes;
          // If the clean blob was stored but the swap failed, delete it best-effort before falling
          // back to the original.
          if (storedFileId !== null) {
            try {
              await ctx.storage.delete(storedFileId);
            } catch (cleanupError) {
              event.orphan_cleanup_error = errMsg(cleanupError);
            }
          }
        }
      }

      // Classify. The port never throws; this try/catch is the last-resort guard.
      let result: ModerationResult;
      try {
        const port = makeModerationPortFromEnv(process.env);
        result = await port.classify(cleanBytes, mime);
      } catch (error) {
        event.error = { stage: "classify", message: errMsg(error) };
        result = unscoredResult("internal_error", true);
      }
      await finish(result);
    } catch (error) {
      // A store/scheduler call failed; the sidecar stays pending (visible to the uploader only).
      event.outcome = "error";
      event.error = { stage: "record", message: errMsg(error) };
    } finally {
      await flush();
    }
  },
});
