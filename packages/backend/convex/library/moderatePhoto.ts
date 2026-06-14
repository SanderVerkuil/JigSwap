"use node";
import { v } from "convex/values";
import { Jimp } from "jimp";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  makeModerationPortFromEnv,
  toArrayBuffer,
} from "./adapters/photoModeration";

// Async image-moderation pipeline for an uploaded copy photo. Scheduled (runAfter 0) by
// `addCopyPhoto`, which inserts the row as `moderationStatus: "pending"`. This action:
//   1. Re-encodes the blob via jimp (a pure-JS codec) — PNG when it has transparency, else JPEG —
//      which DROPS all EXIF/metadata, then swaps the row's fileId to the clean blob and deletes the
//      original.
//   2. Classifies the clean bytes via the configured PhotoModerationPort and records the verdict.
//
// Why jimp (not sharp): Convex's Node runtime bundles the action; sharp ships a platform-specific
// native binary (libvips) that is NOT reliably bundled/loadable there, so it would fail at runtime.
// jimp is dependency-free pure JS, so it bundles and runs deterministically in the Convex runtime.
// Trade-off: jimp is slower/larger in memory than sharp, which is fine for one-off upload moderation.
//
// FAIL-OPEN: any error (download, decode, classify) leaves the photo APPROVED rather than blocking a
// benign upload behind a transient failure — every such path is logged. The action NEVER throws.
//
// ENV (per Convex deployment):
//   HF_MODERATION_TOKEN       — Hugging Face Inference API token (free). Unset => approve (disabled).
//   MODERATION_PROVIDER       — "huggingface" (default) | "none" (always approve).
//   MODERATION_NSFW_THRESHOLD — float in [0,1], default 0.85; nsfw score >= threshold => rejected.

// Re-encode arbitrary image bytes to a metadata-free image. Either output (PNG/JPEG) drops all
// EXIF/metadata. Format is alpha-aware: if the source has ANY transparent pixel we emit PNG so the
// transparency is preserved — a JPEG would flatten the alpha to black (jimp has no WebP encoder).
// Opaque images emit JPEG (smaller). Returns the bytes plus the mime so the caller stores the blob
// with the matching content type.
export const reencodeImage = async (
  input: Uint8Array,
): Promise<{ bytes: Uint8Array; mime: "image/png" | "image/jpeg" }> => {
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
  if (hasAlpha) {
    const out = await image.getBuffer("image/png");
    return { bytes: new Uint8Array(out), mime: "image/png" };
  }
  const out = await image.getBuffer("image/jpeg", { quality: 90 });
  return { bytes: new Uint8Array(out), mime: "image/jpeg" };
};

export const moderatePhoto = internalAction({
  args: { imageId: v.id("ownedPuzzleImages") },
  handler: async (ctx, { imageId }) => {
    const row = await ctx.runQuery(
      internal.library.moderationStore.getImageForModeration,
      { imageId },
    );
    // Gone, or already decided (idempotent: a re-run on an approved/rejected row is a no-op).
    if (!row || row.moderationStatus !== "pending") return;

    let bytes: Uint8Array;
    try {
      const blob = await ctx.storage.get(row.fileId);
      if (!blob) {
        console.error(
          `[moderation] storage blob missing for image ${imageId}; approving (fail-open).`,
        );
        await ctx.runMutation(
          internal.library.moderationStore.setModerationVerdict,
          { imageId, moderationStatus: "approved" },
        );
        return;
      }
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      console.error(
        `[moderation] failed to download blob for image ${imageId}; approving (fail-open).`,
        error instanceof Error ? error.message : String(error),
      );
      await ctx.runMutation(
        internal.library.moderationStore.setModerationVerdict,
        { imageId, moderationStatus: "approved" },
      );
      return;
    }

    // --- Re-encode (strip EXIF/metadata). Best-effort: on decode failure, classify the original. ---
    let cleanBytes = bytes;
    try {
      const { bytes: encoded, mime } = await reencodeImage(bytes);
      cleanBytes = encoded;
      const newFileId = await ctx.storage.store(
        new Blob([toArrayBuffer(cleanBytes)], { type: mime }),
      );
      await ctx.runMutation(
        internal.library.moderationStore.setModerationFile,
        { imageId, fileId: newFileId },
      );
      // The row now points at the clean blob; drop the original (best-effort).
      try {
        await ctx.storage.delete(row.fileId);
      } catch (error) {
        console.error(
          `[moderation] failed to delete original blob for image ${imageId}.`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      console.error(
        `[moderation] re-encode failed for image ${imageId}; keeping original, continuing to classify.`,
        error instanceof Error ? error.message : String(error),
      );
      cleanBytes = bytes;
    }

    // --- Classify. The port itself fails open; this try/catch is the last-resort guard. ---
    try {
      const port = makeModerationPortFromEnv(process.env);
      const result = await port.classify(cleanBytes);
      await ctx.runMutation(
        internal.library.moderationStore.setModerationVerdict,
        {
          imageId,
          moderationStatus: result.status,
          moderationScore: result.score ?? undefined,
          moderationLabel: result.label ?? undefined,
        },
      );
    } catch (error) {
      console.error(
        `[moderation] classification failed for image ${imageId}; approving (fail-open).`,
        error instanceof Error ? error.message : String(error),
      );
      await ctx.runMutation(
        internal.library.moderationStore.setModerationVerdict,
        { imageId, moderationStatus: "approved" },
      );
    }
  },
});
