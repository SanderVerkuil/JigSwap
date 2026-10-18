"use node";

import { v } from "convex/values";
import { Jimp } from "jimp";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { blurhashSampleSize, encodeBlurhash } from "../lib/blurhash";
import { logEvent, type WideEvent } from "../lib/logEvent";
import {
  makeModerationPortFromEnv,
  planModerationStep,
  readScreeningConfig,
  screeningLogFields,
  toArrayBuffer,
  unscoredResult,
  type ModerationResult,
} from "./adapters/photoModeration";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Async image-moderation pipeline for an uploaded copy photo. Scheduled (runAfter 0) by
// `addCopyPhoto`, which inserts the row as `moderationStatus: "pending"`. This action:
//   1. (first attempt only) Re-encodes the blob via jimp (a pure-JS codec) — PNG when it has
//      transparency, else JPEG — which DROPS all EXIF/metadata, then swaps the row's fileId to the
//      clean blob and deletes the original.
//   2. Classifies the clean bytes via the configured PhotoModerationPort and records the verdict.
//
// Why jimp (not sharp): Convex's Node runtime bundles the action; sharp ships a platform-specific
// native binary (libvips) that is NOT reliably bundled/loadable there, so it would fail at runtime.
// jimp is dependency-free pure JS, so it bundles and runs deterministically in the Convex runtime.
// Trade-off: jimp is slower/larger in memory than sharp, which is fine for one-off upload moderation.
//
// NEVER FAILS OPEN: when the photo cannot be checked (provider error, missing token, missing blob,
// unexpected throw) it is NOT approved. A retryable failure keeps it "pending" and re-schedules
// this action with backoff (MODERATION_RETRY_DELAYS_MS); otherwise, or once the retries run out,
// it is stamped "unscored" (with the reason), which keeps it visible to the uploader only. Every
// attempt emits one wide event (screening_outcome / unscored_reason) to the logs and Axiom.
// The action NEVER throws.
//
// ENV: see `adapters/photoModeration.ts` (MODERATION_PROVIDER, HF_MODERATION_TOKEN,
// HF_MODERATION_MODEL, MODERATION_NSFW_THRESHOLD).

// Re-encode arbitrary image bytes to a metadata-free image. Either output (PNG/JPEG) drops all
// EXIF/metadata. Format is alpha-aware: if the source has ANY transparent pixel we emit PNG so the
// transparency is preserved — a JPEG would flatten the alpha to black (jimp has no WebP encoder).
// Opaque images emit JPEG (smaller). Returns the bytes plus the mime so the caller stores the blob
// with the matching content type, and the image's blurhash (lib/blurhash) from the same decode.
export const reencodeImage = async (
  input: Uint8Array,
): Promise<{
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  blurhash: string;
}> => {
  const image = await Jimp.read(Buffer.from(input));
  // bitmap.data is RGBA; a single non-opaque pixel means the image carries real transparency.
  const data = image.bitmap.data;
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      hasAlpha = true;
      break;
    }
  }
  const out = hasAlpha
    ? await image.getBuffer("image/png")
    : await image.getBuffer("image/jpeg", { quality: 90 });
  // Encode the placeholder from a small sample (resize mutates, so it runs after the re-encode).
  const sample = blurhashSampleSize(image.bitmap.width, image.bitmap.height);
  image.resize({ w: sample.width, h: sample.height });
  const blurhash = encodeBlurhash(image.bitmap);
  return {
    bytes: new Uint8Array(out),
    mime: hasAlpha ? "image/png" : "image/jpeg",
    blurhash,
  };
};

export const moderatePhoto = internalAction({
  // `attempt` is 1-based; absent = the first attempt (the upload's schedule).
  args: { imageId: v.id("ownedPuzzleImages"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt: attemptArg }) => {
    const startedAt = Date.now();
    const attempt = attemptArg ?? 1;
    const config = readScreeningConfig(process.env);
    // ONE canonical wide event per attempt (logging-best-practices): high-cardinality ids,
    // business context (copy / uploader / shot kind), the re-encode + classifier facts (model,
    // threshold, the raw per-label scores), the decision, and timing. Built up through the pipeline
    // and flushed once in `finally`, then forwarded to Axiom.
    const event: WideEvent = {
      event: "library.moderatePhoto",
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

    // Record a classification result: schedule another attempt for a retryable unscored result
    // with attempts left, otherwise write the verdict (first verdict wins in the store).
    const finish = async (result: ModerationResult) => {
      Object.assign(event, screeningLogFields(result));
      if (result.status === "unscored") event.outcome = "error";
      const step = planModerationStep(result, attempt);
      if (step.kind === "retry") {
        event.decision = "retry_scheduled";
        event.retry_in_ms = step.delayMs;
        await ctx.scheduler.runAfter(
          step.delayMs,
          internal.library.moderatePhoto.moderatePhoto,
          { imageId, attempt: attempt + 1 },
        );
        return;
      }
      event.decision = result.status;
      await ctx.runMutation(
        internal.library.moderationStore.setModerationVerdict,
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
        internal.library.moderationStore.getImageForModeration,
        { imageId },
      );
      if (!row) {
        event.result = "skipped_missing";
        return;
      }
      event.copy_id = row.ownedPuzzleId;
      event.uploader_id = row.uploaderId;
      event.photo_tag = row.tag ?? null;
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

      // Re-encode (strip EXIF/metadata) on the first attempt only — a retry finds the row already
      // pointing at the clean blob. Best-effort: on decode failure, classify the original.
      let cleanBytes = bytes;
      if (attempt === 1) {
        // Tracks the just-stored clean blob across the try/catch. If `setModerationFile` throws
        // AFTER the store succeeded, the row still points at the original, so the clean blob is
        // unreferenced. There is no storage GC, so we must delete it ourselves.
        let storedFileId: string | null = null;
        try {
          const {
            bytes: encoded,
            mime: encodedMime,
            blurhash,
          } = await reencodeImage(bytes);
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
            internal.library.moderationStore.setModerationFile,
            { imageId, fileId: newFileId, blurhash },
          );
          // Swap succeeded: the row now points at the clean blob, so it is no longer the one to
          // clean up on failure; drop the original instead (best-effort).
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
          // If the clean blob was stored but the row swap failed, the blob is now orphaned (the
          // row still references the original). Delete it best-effort before falling back.
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
      // A store/scheduler call failed; the row stays pending (visible to the uploader only).
      event.outcome = "error";
      event.error = { stage: "record", message: errMsg(error) };
    } finally {
      await flush();
    }
  },
});
