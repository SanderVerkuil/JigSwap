"use node";

import type { FunctionReference } from "convex/server";
import { Jimp } from "jimp";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import {
  makeModerationPortFromEnv,
  planModerationStep,
  readScreeningConfig,
  screeningLogFields,
  toArrayBuffer,
  unscoredResult,
  type ModerationResult,
} from "../../library/adapters/photoModeration";
import { ingestToAxiom } from "../axiom";
import { blurhashSampleSize, encodeBlurhash } from "../blurhash";
import { logEvent, type WideEvent } from "../logEvent";
import {
  checkImageBytes,
  checkImageSize,
  INVALID_IMAGE_LABEL,
  type ImageGuardFailure,
} from "./guards";

// The shared image-moderation pipeline behind every table of uploaded photos (copy photos,
// completion photos, and later message attachments). Each table keeps a thin store module of
// internal functions (load / setFile / setVerdict) and a one-line Node action that calls
// `runImageModeration` with references to them; the pipeline itself knows no table.
//
// Per attempt:
//   1. Load the row (skip when gone or no longer pending: first verdict wins, re-runs are no-ops).
//   2. Input guards (lib/imageModeration/guards): the stored size before downloading the blob,
//      then the magic bytes and the header's pixel count before any decode. A refused upload is
//      "rejected" with label "invalid_image" (the guard's reason in moderationReason), never
//      classified, and its blob is deleted. Never fails open. WebP passes the guards but jimp
//      cannot decode it: it is classified as uploaded (no EXIF strip, no blurhash) and stored again
//      as "image/webp" when the client claimed another type (see guards.ts for why it is kept).
//   3. (first attempt only) Re-encode via jimp — PNG when it has transparency, else JPEG — which
//      DROPS all EXIF/metadata, compute the blurhash from the same decode, swap the row to the
//      clean blob (setFile) and delete the original. A decode failure is refused as
//      "decode_failed", except WebP (see below).
//   4. Classify the clean bytes via the configured PhotoModerationPort.
//   5. Record the verdict (setVerdict), or re-schedule `retry` with backoff for a retryable
//      unscored result with attempts left.
//
// Why jimp (not sharp): Convex's Node runtime bundles the action; sharp ships a platform-specific
// native binary (libvips) that is NOT reliably bundled/loadable there, so it would fail at runtime.
// jimp is dependency-free pure JS, so it bundles and runs deterministically in the Convex runtime.
// Trade-off: jimp is slower/larger in memory than sharp, which is fine for one-off upload moderation.
//
// NEVER FAILS OPEN: when the photo cannot be checked (provider error, missing token, missing blob,
// unexpected throw) it is NOT approved. A retryable failure keeps it "pending" and re-schedules
// with backoff (MODERATION_RETRY_DELAYS_MS); otherwise, or once the retries run out, it is stamped
// "unscored" (with the reason), which keeps it visible to the uploader only. Every attempt emits
// one wide event (screening_outcome / unscored_reason) to the logs and Axiom. NEVER throws.
//
// ENV: see `library/adapters/photoModeration.ts` (MODERATION_PROVIDER, HF_MODERATION_TOKEN,
// HF_MODERATION_MODEL, MODERATION_NSFW_THRESHOLD, SIGHTENGINE_*).

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

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

/** The row fields the pipeline itself needs; a table's `load` may return more (for `describe`). */
export type ModerationRow = {
  fileId: Id<"_storage">;
  moderationStatus?: string;
};

/** The verdict the pipeline writes through a table's `setVerdict`. */
export type ModerationVerdictArgs = {
  imageId: string;
  moderationStatus: "approved" | "rejected" | "unscored";
  moderationScore?: number;
  moderationLabel?: string;
  moderationReason?: string;
  moderationAttempts?: number;
};

/**
 * The table-specific steps, as references to that table's internal functions. Adding a table
 * means writing these (plus a Node action that calls `runImageModeration`), never editing the
 * pipeline. The image id is typed `string` here so one pipeline serves every table: each
 * reference narrows it to its own `Id<"table">`, and the id the pipeline passes back is always the
 * one the calling action received (validated by its `v.id(...)` arg).
 */
export interface ImageModerationSteps<R extends ModerationRow> {
  /** The wide event's name, e.g. "library.moderatePhoto". */
  event: string;
  /** Load the row; null when it vanished. */
  load: FunctionReference<"query", "internal", { imageId: string }, R | null>;
  /** Business context of the row for the wide event (ids, kind of photo), never image data. */
  describe: (row: R) => Record<string, unknown>;
  /** Point the row at the re-encoded blob and store its blurhash. */
  setFile: FunctionReference<
    "mutation",
    "internal",
    { imageId: string; fileId: Id<"_storage">; blurhash?: string },
    unknown
  >;
  /** Record the verdict (first verdict wins, in the store). */
  setVerdict: FunctionReference<
    "mutation",
    "internal",
    ModerationVerdictArgs,
    unknown
  >;
  /** The calling action itself, re-scheduled for a retry. */
  retry: FunctionReference<
    "action",
    "internal",
    { imageId: string; attempt?: number },
    unknown
  >;
}

/** Run one moderation attempt (1-based `attempt`) for `imageId`. Never throws. */
export const runImageModeration = async <R extends ModerationRow>(
  ctx: ActionCtx,
  steps: ImageModerationSteps<R>,
  { imageId, attempt }: { imageId: string; attempt: number },
): Promise<void> => {
  const startedAt = Date.now();
  const config = readScreeningConfig(process.env);
  // ONE canonical wide event per attempt (logging-best-practices): high-cardinality ids,
  // business context (from `describe`), the re-encode + classifier facts (model, threshold, the
  // raw per-label scores), the decision, and timing. Built up through the pipeline and flushed
  // once in `finally`, then forwarded to Axiom.
  const event: WideEvent = {
    event: steps.event,
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
      await ctx.scheduler.runAfter(step.delayMs, steps.retry, {
        imageId,
        attempt: attempt + 1,
      });
      return;
    }
    event.decision = result.status;
    await ctx.runMutation(steps.setVerdict, {
      imageId,
      moderationStatus: result.status,
      moderationScore: result.score ?? undefined,
      moderationLabel: result.label ?? undefined,
      moderationReason: result.reason ?? undefined,
      moderationAttempts: attempt,
    });
  };

  try {
    const row = await ctx.runQuery(steps.load, { imageId });
    if (!row) {
      event.result = "skipped_missing";
      return;
    }
    Object.assign(event, steps.describe(row));
    // Already decided (idempotent): a re-run on a decided row is a no-op.
    if (row.moderationStatus !== "pending") {
      event.result = "skipped_not_pending";
      event.prior_status = row.moderationStatus ?? null;
      return;
    }

    // Refuse an upload that fails an input guard: reject it (first verdict wins), then delete
    // the blob, but only when the row took this verdict and still points at it, so a blob a
    // concurrent attempt already decided on is never touched. A store's own reject side effects
    // may have deleted it already (completion photos), hence the existence check.
    const refuse = async (reason: ImageGuardFailure) => {
      event.input_guard = reason;
      event.decision = "rejected";
      await ctx.runMutation(steps.setVerdict, {
        imageId,
        moderationStatus: "rejected",
        moderationLabel: INVALID_IMAGE_LABEL,
        moderationReason: reason,
        moderationAttempts: attempt,
      });
      const after = await ctx.runQuery(steps.load, { imageId });
      if (
        after?.moderationStatus !== "rejected" ||
        after.fileId !== row.fileId
      ) {
        return;
      }
      const stillStored = await ctx.runQuery(
        internal.lib.imageModeration.blobMetadata.getBlobSize,
        { storageId: row.fileId },
      );
      if (stillStored === null) return;
      try {
        await ctx.storage.delete(row.fileId);
      } catch (error) {
        event.delete_original_error = errMsg(error);
      }
    };

    // Size guard BEFORE the download. A missing blob falls through to the download step, which
    // records it as unscored (missing_file) exactly as before.
    const storedBytes = await ctx.runQuery(
      internal.lib.imageModeration.blobMetadata.getBlobSize,
      { storageId: row.fileId },
    );
    if (storedBytes !== null) {
      event.stored_bytes = storedBytes;
      const size = checkImageSize(storedBytes);
      if (!size.ok) {
        await refuse(size.reason);
        return;
      }
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

    // Type + decompression-bomb guards on the header, before anything decodes the bytes.
    const guard = checkImageBytes(bytes);
    if (!guard.ok) {
      await refuse(guard.reason);
      return;
    }
    event.image_format = guard.format;
    event.image_width = guard.width;
    event.image_height = guard.height;

    // Re-encode (strip EXIF/metadata) on the first attempt only — a retry finds the row already
    // pointing at the clean blob. A decode failure is refused (a header that says JPEG/PNG/GIF
    // over a body that is not one is a polyglot or a corrupt file), except for WebP, which jimp
    // cannot decode: it keeps the best-effort path and is classified as uploaded, but is stored
    // again as "image/webp" when the client claimed another type, so the blob is never served
    // as HTML or SVG.
    let cleanBytes = bytes;
    if (attempt === 1) {
      let encoded: Awaited<ReturnType<typeof reencodeImage>> | null = null;
      try {
        encoded = await reencodeImage(bytes);
        event.reencoded = true;
        event.reencoded_mime = encoded.mime;
        event.reencoded_bytes = encoded.bytes.length;
      } catch (error) {
        event.reencoded = false;
        event.reencode_error = errMsg(error);
      }
      if (!encoded && guard.format !== "webp") {
        await refuse("decode_failed");
        return;
      }
      const replacement = encoded
        ? encoded
        : mime !== "image/webp"
          ? { bytes, mime: "image/webp", blurhash: undefined }
          : null;
      if (!encoded && replacement) event.restored_as = "image/webp";
      if (replacement) {
        // Tracks the just-stored blob across the try/catch. If `setFile` throws AFTER the store
        // succeeded, the row still points at the original, so the new blob is unreferenced.
        // There is no storage GC, so we must delete it ourselves.
        let storedFileId: Id<"_storage"> | null = null;
        try {
          const newFileId = await ctx.storage.store(
            new Blob([toArrayBuffer(replacement.bytes)], {
              type: replacement.mime,
            }),
          );
          storedFileId = newFileId;
          await ctx.runMutation(steps.setFile, {
            imageId,
            fileId: newFileId,
            blurhash: replacement.blurhash,
          });
          // Swap succeeded: the row now points at the new blob, so it is no longer the one to
          // clean up on failure; drop the original instead (best-effort).
          storedFileId = null;
          cleanBytes = replacement.bytes;
          mime = replacement.mime;
          try {
            await ctx.storage.delete(row.fileId);
          } catch (error) {
            event.delete_original_error = errMsg(error);
          }
        } catch (error) {
          event.reencoded = false;
          event.swap_error = errMsg(error);
          // If the new blob was stored but the row swap failed, it is orphaned (the row still
          // references the original). Delete it best-effort before falling back.
          if (storedFileId !== null) {
            try {
              await ctx.storage.delete(storedFileId);
            } catch (cleanupError) {
              event.orphan_cleanup_error = errMsg(cleanupError);
            }
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
};
