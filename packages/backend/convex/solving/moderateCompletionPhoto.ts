"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import {
  HF_MODEL,
  makeModerationPortFromEnv,
  readThreshold,
  toArrayBuffer,
} from "../library/adapters/photoModeration";
import { reencodeImage } from "../library/moderatePhoto";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Async image-moderation pipeline for an uploaded completion photo — a clone of
// `library/moderatePhoto.ts` operating on the `completionImages` sidecar table (see that file for
// the full rationale: jimp-not-sharp, wide-event logging, env knobs). Scheduled (runAfter 0) by
// `attachCompletionPhotos`, which inserts the sidecar as `moderationStatus: "pending"`. This
// action:
//   1. Re-encodes the blob via jimp (drops all EXIF/GPS metadata), then swaps the fileId to the
//      clean blob — in BOTH the sidecar and the completions row's photos array, via
//      `completionModerationStore.setModerationFile` — and deletes the original.
//   2. Classifies the clean bytes via the configured PhotoModerationPort and records the verdict
//      (a rejection also removes the photo from the completion + deletes the blob + stamps).
//
// FAIL-OPEN: any error (download, decode, classify) leaves the photo APPROVED rather than blocking
// a benign upload behind a transient failure — every such path is logged. The action NEVER throws.
//
// ENV (per Convex deployment):
//   HF_MODERATION_TOKEN       — Hugging Face Inference API token (free). Unset => approve (disabled).
//   MODERATION_PROVIDER       — "huggingface" (default) | "none" (always approve).
//   MODERATION_NSFW_THRESHOLD — float in [0,1], default 0.85; nsfw score >= threshold => rejected.
export const moderateCompletionPhoto = internalAction({
  args: { imageId: v.id("completionImages") },
  handler: async (ctx, { imageId }) => {
    const startedAt = Date.now();
    const provider = (process.env.MODERATION_PROVIDER ?? "huggingface").trim();
    // ONE canonical wide event per moderation, flushed once in `finally` (see library clone).
    const event: WideEvent = {
      event: "solving.moderateCompletionPhoto",
      outcome: "success",
      image_id: imageId,
      provider,
      model: provider.toLowerCase() === "none" ? null : HF_MODEL,
      nsfw_threshold: readThreshold(process.env.MODERATION_NSFW_THRESHOLD),
    };
    const flush = async () => {
      event.duration_ms = Date.now() - startedAt;
      const line = logEvent(event);
      await ingestToAxiom(line);
    };

    const approve = () =>
      ctx.runMutation(
        internal.solving.completionModerationStore.setModerationVerdict,
        { imageId, moderationStatus: "approved" },
      );

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
      // Already decided (idempotent): a re-run on an approved/rejected row is a no-op.
      if (row.moderationStatus !== "pending") {
        event.result = "skipped_not_pending";
        event.prior_status = row.moderationStatus ?? null;
        return;
      }

      let bytes: Uint8Array;
      try {
        const blob = await ctx.storage.get(row.fileId);
        if (!blob) {
          event.outcome = "error";
          event.error = { stage: "download", message: "storage blob missing" };
          event.decision = "approved";
          event.fail_open = true;
          await approve();
          return;
        }
        bytes = new Uint8Array(await blob.arrayBuffer());
        event.original_bytes = bytes.length;
      } catch (error) {
        event.outcome = "error";
        event.error = { stage: "download", message: errMsg(error) };
        event.decision = "approved";
        event.fail_open = true;
        await approve();
        return;
      }

      // Re-encode (strip EXIF/metadata). Best-effort: on decode failure, classify the original —
      // no file swap happens on that path (verdict-only approval).
      let cleanBytes = bytes;
      // Tracks the just-stored clean blob across the try/catch. If `setModerationFile` throws
      // AFTER the store succeeded, the row still points at the original, so the clean blob is
      // unreferenced. There is no storage GC, so delete it ourselves to avoid orphaning it.
      let storedFileId: string | null = null;
      try {
        const { bytes: encoded, mime } = await reencodeImage(bytes);
        cleanBytes = encoded;
        event.reencoded = true;
        event.reencoded_mime = mime;
        event.reencoded_bytes = encoded.length;
        const newFileId = await ctx.storage.store(
          new Blob([toArrayBuffer(cleanBytes)], { type: mime }),
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

      // Classify. The port itself fails open; this try/catch is the last-resort guard.
      try {
        const port = makeModerationPortFromEnv(process.env);
        const result = await port.classify(cleanBytes);
        await ctx.runMutation(
          internal.solving.completionModerationStore.setModerationVerdict,
          {
            imageId,
            moderationStatus: result.status,
            moderationScore: result.score ?? undefined,
            moderationLabel: result.label ?? undefined,
          },
        );
        event.decision = result.status;
        event.nsfw_score = result.score ?? null;
        event.nsfw_label = result.label ?? null;
        event.classifier_scores = result.scores;
      } catch (error) {
        event.outcome = "error";
        event.error = { stage: "classify", message: errMsg(error) };
        event.decision = "approved";
        event.fail_open = true;
        await approve();
      }
    } finally {
      await flush();
    }
  },
});
