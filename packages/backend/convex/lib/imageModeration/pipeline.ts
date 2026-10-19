"use node";

import { createHash } from "node:crypto";
import type { FunctionReference } from "convex/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import {
  makeModerationPortFromEnv,
  nextRetryDelayMs,
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
  checkAllHashes,
  makeCsamHashCheckPortFromEnv,
  readCsamHashCheckConfig,
  type ImageHashes,
} from "./csamHashCheck";
import {
  checkImageBytes,
  INVALID_IMAGE_LABEL,
  type ImageFormat,
  type ImageGuardFailure,
} from "./guards";
import { decodeUpright, hasTransparency } from "./normaliseImage";
import { findMetadata, stripImageMetadata } from "./stripMetadata";

// The shared image-moderation pipeline behind every table of uploaded photos (copy photos,
// completion photos, and later message attachments). Each table keeps a thin store module of
// internal functions (load / setFile / setVerdict) and a one-line Node action that calls
// `runImageModeration` with references to them; the pipeline itself knows no table.
//
// Per attempt:
//   1. Load the row (skip when gone or no longer pending: first verdict wins, re-runs are no-ops).
//   2. Download the blob (an upload over HASH_MAX_BYTES is refused unread) and run the input
//      guards (lib/imageModeration/guards): size, magic bytes, the header's pixel count, all
//      before any decode. Then (on any attempt until the row is marked `reencodedAt`) strip the
//      metadata at byte level (lib/imageModeration/stripMetadata: Exif incl. GPS, XMP, IPTC,
//      comments, PNG text chunks, WebP EXIF/XMP, Orientation included) and re-encode that in
//      memory via jimp, turned upright for the Orientation the Exif held — PNG when it has
//      transparency, else JPEG — plus the blurhash. A malformed block structure or a decode
//      failure is refused as "decode_failed". An upright WebP (no Orientation, or 1) is not
//      re-encoded: its stripped bytes are stored (as "image/webp"); one that needs turning is
//      decoded (WASM) and re-encoded like the rest. Whatever is stored must show no metadata
//      left (findMetadata), or it is refused too.
//   3. CSAM hash check (lib/imageModeration/csamHashCheck), until the row has passed one: MD5 +
//      SHA-1 of the ORIGINAL bytes (what hash lists match) and of the re-encode (what is stored,
//      upright), BEFORE any refusal, swap or classification. A match stores the matched bytes
//      again as a NEW blob, calls the table's `quarantine` (always escalates) and deletes the
//      uploaded blob, so no URL ever issued points at the evidence; nothing else runs. no_match
//      opens the publication gate (setHashCheck; lib/imageModeration/hashCheckFields), but only
//      once the row holds the clean blob (after step 5): no read model serves the row before,
//      so no URL is ever issued for the upload as sent. "unavailable" is logged at error level
//      and the gate stays closed.
//   4. A refused upload is "rejected" with label "invalid_image" (the reason in
//      moderationReason), never classified, and its blob is deleted. Never fails open.
//   5. Swap the row to the clean blob (setFile) and delete the original.
//   6. Classify the clean bytes via the configured PhotoModerationPort.
//   7. Record the verdict (setVerdict), or re-schedule `retry` with backoff for a retryable
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
// HF_MODERATION_MODEL, MODERATION_NSFW_THRESHOLD, SIGHTENGINE_*) and `./csamHashCheck.ts`
// (CSAM_HASHCHECK_PROVIDER, OFFLIMITS_HCS_*). A blob preserved for a CSAM escalation is never
// deleted, on any path.

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Lowercase hex MD5 + SHA-1 of the bytes, the pair hash lists such as Offlimits HCS match on. */
export const hashImageBytes = (bytes: Uint8Array): ImageHashes => ({
  md5: createHash("md5").update(bytes).digest("hex"),
  sha1: createHash("sha1").update(bytes).digest("hex"),
});

// Re-encode stripped image bytes (no Exif) to a metadata-free image, turned upright for the
// Orientation (1..8) the stripped Exif held (lib/imageModeration/normaliseImage). Either output
// (PNG/JPEG) carries no metadata. Format is alpha-aware: if the source has ANY transparent pixel
// we emit PNG so the transparency is preserved — a JPEG would flatten the alpha to black (jimp has
// no WebP encoder). Opaque images emit JPEG (smaller). Returns the bytes plus the mime so the
// caller stores the blob with the matching content type, and the image's blurhash (lib/blurhash)
// from the same decode. A WebP is decoded with the WASM decoder (only called for one that needs
// turning; see runImageModeration).
export const reencodeImage = async (
  input: Uint8Array,
  format: ImageFormat,
  orientation: number,
): Promise<{
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  blurhash: string;
}> => {
  const image = await decodeUpright(input, format, orientation);
  // bitmap.data is RGBA; a single non-opaque pixel means the image carries real transparency.
  const hasAlpha = hasTransparency(image.bitmap.data);
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

/** Uploads larger than this are refused without being read or hashed (memory bound). */
export const HASH_MAX_BYTES = 50 * 1024 * 1024;

/** The row fields the pipeline itself needs; a table's `load` may return more (for `describe`). */
export type ModerationRow = {
  fileId: Id<"_storage">;
  moderationStatus?: string;
  /** Set by `setFile` once the row holds its re-encoded blob (absent = still the upload). */
  reencodedAt?: number;
  uploaderId: Id<"users">;
  hashCheckedAt?: number;
  pendingHashes?: ImageHashes[];
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

/** What a table's `quarantine` step receives (lib/imageModeration/quarantine.quarantineArgs). */
export type QuarantineArgs = {
  imageId: string;
  fileId?: Id<"_storage">;
  uploaderId: Id<"users">;
  md5: string;
  sha1: string;
  provider: string;
  originalDiscarded: boolean;
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
  /**
   * A CSAM hash match: force the row to "quarantined" on the preserved blob, hide it wherever
   * else the table references it, and raise the escalation (always, even when the row is gone).
   * Returns the escalation id.
   */
  quarantine: FunctionReference<"mutation", "internal", QuarantineArgs, string>;
  /** Record a no_match (opens the publication gate) or unavailable hash-check outcome. */
  setHashCheck: FunctionReference<
    "mutation",
    "internal",
    {
      imageId: string;
      status: "no_match" | "unavailable";
      hashes?: ImageHashes[];
    },
    unknown
  >;
  /** The calling action itself, re-scheduled for a retry. */
  retry: FunctionReference<
    "action",
    "internal",
    { imageId: string; attempt?: number },
    unknown
  >;
  /** The table's hash re-check action (runs `runHashRecheck`), scheduled while unavailable. */
  recheck: FunctionReference<
    "action",
    "internal",
    { imageId: string; attempt?: number },
    unknown
  >;
}

/**
 * Backoff for re-checking the STORED hashes of a photo whose hash check was "unavailable": 15
 * minutes after the upload, doubling up to 24 hours, then every 24 hours for as long as the row
 * is still waiting. Meanwhile the photo stays unpublished (no hashCheckedAt => no URL).
 */
export const HASH_RECHECK_DELAYS_MS: readonly number[] = [
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  16 * 60 * 60_000,
  24 * 60 * 60_000,
];

/** The delay before re-check `attempt` (1-based). */
export const hashRecheckDelayMs = (attempt: number): number =>
  HASH_RECHECK_DELAYS_MS[attempt - 1] ??
  HASH_RECHECK_DELAYS_MS[HASH_RECHECK_DELAYS_MS.length - 1];

/** Declare a table's steps once (typed, so `describe` sees the row type), for both actions. */
export const imageModerationSteps = <R extends ModerationRow>(
  steps: ImageModerationSteps<R>,
): ImageModerationSteps<R> => steps;

/**
 * Preserve matched bytes and quarantine: store them again as a NEW blob (never served, so no URL
 * ever issued can reach it), run the table's quarantine step (which always escalates), then
 * delete the blob the row pointed at. Afterwards the wide event carries ONLY the escalation id:
 * no row, uploader or image ids, no decision label.
 */
export const preserveAndQuarantine = async (
  ctx: ActionCtx,
  quarantine: ImageModerationSteps<ModerationRow>["quarantine"],
  event: WideEvent,
  args: {
    imageId: string;
    bytes: Uint8Array;
    uploadedFileId: Id<"_storage"> | null;
    uploaderId: Id<"users">;
    matched: ImageHashes;
    provider: string;
    originalDiscarded: boolean;
  },
) => {
  const preservedId = await ctx.storage.store(
    new Blob([toArrayBuffer(args.bytes)], { type: "application/octet-stream" }),
  );
  let escalationId: string;
  try {
    escalationId = await ctx.runMutation(quarantine, {
      imageId: args.imageId,
      fileId: preservedId,
      uploaderId: args.uploaderId,
      md5: args.matched.md5,
      sha1: args.matched.sha1,
      provider: args.provider,
      originalDiscarded: args.originalDiscarded,
    });
  } catch (error) {
    // The uploaded blob is untouched, so nothing is lost; drop the unreferenced copy.
    await ctx.storage.delete(preservedId).catch(() => {});
    throw error;
  }
  // Best-effort: the uploaded blob may already be gone (the uploader removed the photo).
  if (args.uploadedFileId) {
    await ctx.storage.delete(args.uploadedFileId).catch(() => {});
  }
  for (const key of Object.keys(event)) {
    if (key !== "event" && key !== "outcome" && key !== "attempt") {
      delete event[key];
    }
  }
  event.csam_hashcheck_status = "match";
  event.escalation_id = escalationId;
};

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
  // once in `finally`, then forwarded to Axiom. On a CSAM match it is cut down to the
  // escalation id (preserveAndQuarantine).
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
  const hashConfig = readCsamHashCheckConfig(process.env);
  event.csam_hashcheck_provider = hashConfig.provider;
  event.csam_hashcheck_config = hashConfig.status;
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

  // Delete an original blob unless a CSAM escalation preserves it.
  const deleteUnlessPreserved = async (fileId: Id<"_storage">) => {
    const preserved = await ctx.runQuery(
      internal.lib.imageModeration.quarantine.isBlobPreserved,
      { storageId: fileId },
    );
    if (preserved) {
      event.original_preserved = true;
      return;
    }
    try {
      await ctx.storage.delete(fileId);
    } catch (error) {
      event.delete_original_error = errMsg(error);
    }
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

    // A row that references a blob already preserved for an escalation (a re-used storage id)
    // is quarantined at once and joins that escalation; the blob is never read, swapped or
    // deleted.
    const preservedHashes = await ctx.runQuery(
      internal.lib.imageModeration.quarantine.getPreservedHashes,
      { storageId: row.fileId },
    );
    if (preservedHashes) {
      const escalationId = await ctx.runMutation(steps.quarantine, {
        imageId,
        fileId: row.fileId,
        uploaderId: row.uploaderId,
        ...preservedHashes,
        provider: hashConfig.provider,
        originalDiscarded: false,
      });
      for (const key of Object.keys(event)) {
        if (key !== "event" && key !== "outcome" && key !== "attempt") {
          delete event[key];
        }
      }
      event.csam_hashcheck_status = "already_preserved";
      event.escalation_id = escalationId;
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
      await deleteUnlessPreserved(row.fileId);
    };

    // Too large to even read: refused without hashing (it cannot be held in memory). Anything
    // up to HASH_MAX_BYTES is downloaded and hash-checked before the size guard refuses it.
    const storedBytes = await ctx.runQuery(
      internal.lib.imageModeration.blobMetadata.getBlobSize,
      { storageId: row.fileId },
    );
    if (storedBytes !== null) {
      event.stored_bytes = storedBytes;
      if (storedBytes > HASH_MAX_BYTES) {
        await refuse("too_large");
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

    // Size, type and decompression-bomb guards on the header, before anything decodes the bytes.
    const guard = checkImageBytes(bytes);
    let refusal: ImageGuardFailure | null = guard.ok ? null : guard.reason;
    if (guard.ok) {
      event.image_format = guard.format;
      event.image_width = guard.width;
      event.image_height = guard.height;
    }

    // Strip + re-encode on ANY attempt until the row is marked re-encoded, so a retry after a
    // download or swap failure never classifies (and so never publishes) the original with its
    // EXIF/GPS. In memory only: nothing is stored or deleted until the hash check has passed. A
    // malformed or undecodable image is refused (a header that says JPEG/PNG/GIF over a body
    // that is not one is a polyglot or a corrupt file); an upright WebP keeps its stripped bytes.
    let encoded: {
      bytes: Uint8Array;
      mime: string;
      blurhash?: string;
    } | null = null;
    if (guard.ok && row.reencodedAt === undefined) {
      // GIF has no byte-level stripper: jimp's re-encode (PNG/JPEG) drops its extensions.
      const stripped =
        guard.format === "gif"
          ? { bytes, orientation: 1 }
          : stripImageMetadata(bytes, guard.format);
      if (stripped === null) {
        event.strip_error = "malformed";
        refusal = "decode_failed";
      } else if (guard.format === "webp" && stripped.orientation === 1) {
        // Upright already: stored as its stripped bytes (not re-encoded, no blurhash).
        event.stripped_bytes = stripped.bytes.length;
        event.reencoded = false;
        encoded = { bytes: stripped.bytes, mime: "image/webp" };
      } else {
        event.stripped_bytes = stripped.bytes.length;
        event.orientation = stripped.orientation;
        try {
          encoded = await reencodeImage(
            stripped.bytes,
            guard.format,
            stripped.orientation,
          );
          event.reencoded = true;
        } catch (error) {
          event.reencoded = false;
          event.reencode_error = errMsg(error);
          refusal = "decode_failed";
        }
      }
      if (encoded) {
        event.reencoded_mime = encoded.mime;
        event.reencoded_bytes = encoded.bytes.length;
        // Defence in depth: what is about to be stored must carry no metadata at all.
        const format =
          encoded.mime === "image/webp"
            ? "webp"
            : encoded.mime === "image/png"
              ? "png"
              : "jpeg";
        const left = findMetadata(encoded.bytes, format);
        if (left === null || left.length > 0) {
          event.metadata_left = left === null ? "malformed" : left.join(",");
          encoded = null;
          refusal = "decode_failed";
        }
      }
    }

    // CSAM hash check until the row has passed one, BEFORE any refusal, swap or classification.
    // Only the outcome is logged, never the hashes. Once "unavailable" has stored the hashes,
    // the scheduled re-check (runHashRecheck) owns the outcome. A no_match opens the gate only
    // after the swap below, so the upload as sent is never served.
    let openGate = false;
    if (row.hashCheckedAt === undefined && row.pendingHashes === undefined) {
      const variants = encoded
        ? [hashImageBytes(bytes), hashImageBytes(encoded.bytes)]
        : [hashImageBytes(bytes)];
      const hashCheck = await checkAllHashes(
        makeCsamHashCheckPortFromEnv(process.env),
        variants,
      );
      event.csam_hashcheck_status = hashCheck.status;
      event.csam_hashcheck_reason = hashCheck.reason ?? null;
      if (hashCheck.status === "match" && hashCheck.matched) {
        await preserveAndQuarantine(ctx, steps.quarantine, event, {
          imageId,
          bytes,
          uploadedFileId: row.fileId,
          uploaderId: row.uploaderId,
          matched: hashCheck.matched,
          provider: hashConfig.provider,
          originalDiscarded: false,
        });
        return;
      }
      openGate = hashCheck.status === "no_match" && refusal === null;
      // Unavailable: the gate stays closed. Keep the hashes (of the original AND the re-encode,
      // since the original is deleted after the swap below) and re-check them later. Surface it
      // at error level for alerting.
      if (hashCheck.status === "unavailable") {
        event.outcome = "error";
        if (refusal === null) {
          await ctx.runMutation(steps.setHashCheck, {
            imageId,
            status: "unavailable",
            hashes: variants,
          });
          const delayMs = hashRecheckDelayMs(1);
          await ctx.scheduler.runAfter(delayMs, steps.recheck, {
            imageId,
            attempt: 1,
          });
          event.hash_recheck_in_ms = delayMs;
        }
      }
    }

    if (refusal !== null) {
      await refuse(refusal);
      return;
    }

    // Swap the row to the clean blob (the re-encode, or a WebP's stripped bytes) and drop the
    // original. A row not yet re-encoded always has `encoded` here (otherwise it was refused);
    // a WebP that had nothing to strip and is stored as image/webp already stays as it is.
    let cleanBytes = bytes;
    const unchanged =
      encoded !== null &&
      encoded.mime === mime &&
      encoded.bytes.length === bytes.length &&
      encoded.bytes.every((byte, i) => byte === bytes[i]);
    const replacement =
      row.reencodedAt !== undefined || unchanged ? null : encoded;
    if (replacement) {
      // Tracks the just-stored blob across the try/catch. If `setFile` throws AFTER the store
      // succeeded, the row still points at the original, so the new blob is unreferenced. There
      // is no storage GC, so we must delete it ourselves.
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
        await deleteUnlessPreserved(row.fileId);
      } catch (error) {
        event.reencoded = false;
        event.swap_error = errMsg(error);
        // If the new blob was stored but the row swap failed, it is orphaned (the row still
        // references the original). Delete it best-effort.
        if (storedFileId !== null) {
          try {
            await ctx.storage.delete(storedFileId);
          } catch (cleanupError) {
            event.orphan_cleanup_error = errMsg(cleanupError);
          }
        }
        // Never classify (and so never publish) the original: retry the whole attempt, and
        // once the retries are spent refuse it rather than approve it.
        const delayMs = nextRetryDelayMs(attempt);
        if (delayMs !== null) {
          event.decision = "retry_scheduled";
          event.retry_in_ms = delayMs;
          await ctx.scheduler.runAfter(delayMs, steps.retry, {
            imageId,
            attempt: attempt + 1,
          });
        } else {
          await refuse("decode_failed");
        }
        return;
      }
    }

    // The row holds the clean blob now: open the publication gate.
    if (openGate) {
      await ctx.runMutation(steps.setHashCheck, {
        imageId,
        status: "no_match",
      });
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

/**
 * Re-check the STORED hashes of a photo whose hash check was "unavailable" (1-based `attempt`).
 * no_match opens the publication gate; unavailable re-schedules with HASH_RECHECK_DELAYS_MS; a
 * match quarantines exactly like the live pipeline, preserving the blob the row holds now (the
 * re-encode: the original was deleted after the swap, which the escalation records as
 * `originalDiscarded`). Never throws.
 */
export const runHashRecheck = async <R extends ModerationRow>(
  ctx: ActionCtx,
  steps: ImageModerationSteps<R>,
  { imageId, attempt }: { imageId: string; attempt: number },
): Promise<void> => {
  const startedAt = Date.now();
  const hashConfig = readCsamHashCheckConfig(process.env);
  const event: WideEvent = {
    event: `${steps.event}.hashRecheck`,
    outcome: "success",
    image_id: imageId,
    attempt,
    csam_hashcheck_provider: hashConfig.provider,
    csam_hashcheck_config: hashConfig.status,
  };
  try {
    const row = await ctx.runQuery(steps.load, { imageId });
    if (
      !row ||
      row.moderationStatus === "quarantined" ||
      row.hashCheckedAt !== undefined ||
      !row.pendingHashes
    ) {
      event.result = "skipped";
      return;
    }
    const hashCheck = await checkAllHashes(
      makeCsamHashCheckPortFromEnv(process.env),
      row.pendingHashes,
    );
    event.csam_hashcheck_status = hashCheck.status;
    event.csam_hashcheck_reason = hashCheck.reason ?? null;
    if (hashCheck.status === "match" && hashCheck.matched) {
      const blob = await ctx.storage.get(row.fileId).catch(() => null);
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      if (bytes) {
        await preserveAndQuarantine(ctx, steps.quarantine, event, {
          imageId,
          bytes,
          uploadedFileId: row.fileId,
          uploaderId: row.uploaderId,
          matched: hashCheck.matched,
          provider: hashConfig.provider,
          originalDiscarded: row.pendingHashes.length > 1,
        });
        return;
      }
      // The blob is gone too: escalate on the hashes alone.
      const escalationId = await ctx.runMutation(steps.quarantine, {
        imageId,
        uploaderId: row.uploaderId,
        md5: hashCheck.matched.md5,
        sha1: hashCheck.matched.sha1,
        provider: hashConfig.provider,
        originalDiscarded: true,
      });
      for (const key of Object.keys(event)) {
        if (key !== "event" && key !== "outcome" && key !== "attempt") {
          delete event[key];
        }
      }
      event.csam_hashcheck_status = "match";
      event.escalation_id = escalationId;
      return;
    }
    if (hashCheck.status === "no_match") {
      await ctx.runMutation(steps.setHashCheck, {
        imageId,
        status: "no_match",
      });
      return;
    }
    event.outcome = "error";
    const delayMs = hashRecheckDelayMs(attempt + 1);
    await ctx.scheduler.runAfter(delayMs, steps.recheck, {
      imageId,
      attempt: attempt + 1,
    });
    event.hash_recheck_in_ms = delayMs;
  } catch (error) {
    event.outcome = "error";
    event.error = { stage: "recheck", message: errMsg(error) };
  } finally {
    event.duration_ms = Date.now() - startedAt;
    await ingestToAxiom(logEvent(event));
  }
};
