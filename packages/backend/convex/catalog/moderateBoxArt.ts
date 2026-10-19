"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { INVALID_IMAGE_LABEL } from "../lib/imageModeration/guards";
import {
  imageModerationSteps,
  runHashRecheck,
  runImageModeration,
} from "../lib/imageModeration/pipeline";
import { boxArtRefused, type BoxArtRefusal } from "./boxArtUploads";

// Box art through the shared image-moderation pipeline (lib/imageModeration/pipeline), with
// `boxArtUploads` as its store (catalog/boxArtModerationStore): the same input guards, metadata
// strip + turned upright, CSAM hash check (a match quarantines and escalates exactly as for a copy
// photo), content classification, retries and hash re-checks.
//
// Unlike a copy photo, box art is checked while the uploader waits (`checkBoxArt`, called by
// catalog/sanitizeBoxArt and catalog/importPuzzleImage): the first pipeline attempt runs inline,
// so a refused image is refused on the spot, and the form only gets an id it may use. When that
// attempt cannot decide (the classifier or the hash service is unavailable), the id is handed out
// anyway and the box art stays unserved (lib/imageModeration/boxArtUrl: the placeholder, for
// everyone) until the scheduled retries approve it, the way a copy photo stays unpublished.
const steps = imageModerationSteps({
  event: "catalog.moderateBoxArt",
  load: internal.catalog.boxArtModerationStore.getForModeration,
  describe: (row) => ({ uploader_id: row.uploaderId }),
  setFile: internal.catalog.boxArtModerationStore.setFile,
  setVerdict: internal.catalog.boxArtModerationStore.setVerdict,
  quarantine: internal.catalog.boxArtModerationStore.quarantine,
  setHashCheck: internal.catalog.boxArtModerationStore.setHashCheck,
  retry: internal.catalog.moderateBoxArt.moderateBoxArt,
  recheck: internal.catalog.moderateBoxArt.recheckHashes,
});

// A later attempt (the pipeline's retry backoff).
export const moderateBoxArt = internalAction({
  args: { imageId: v.id("boxArtUploads"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runImageModeration(ctx, steps, { imageId, attempt: attempt ?? 1 }),
});

// Re-check the stored hashes of box art whose CSAM hash check was unavailable (backoff).
export const recheckHashes = internalAction({
  args: { imageId: v.id("boxArtUploads"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runHashRecheck(ctx, steps, { imageId, attempt: attempt ?? 1 }),
});

const GUARD_REFUSALS: ReadonlySet<string> = new Set<BoxArtRefusal>([
  "too_large",
  "unsupported_format",
  "unreadable_header",
  "too_many_pixels",
]);

/** Why a rejected row was refused, as the box-art error reports it. */
const refusalOf = (row: {
  moderationLabel?: string;
  moderationReason?: string;
}): BoxArtRefusal => {
  if (row.moderationLabel !== INVALID_IMAGE_LABEL) return "not_allowed";
  return GUARD_REFUSALS.has(row.moderationReason ?? "")
    ? (row.moderationReason as BoxArtRefusal)
    : "malformed";
};

/**
 * List a fresh upload as box art for the acting member and run the first pipeline attempt on it
 * now. Returns the storage id the catalog mutations take as `image` (the clean blob), or throws:
 * "InvalidUpload" when the upload can't be claimed, "InvalidImage" when it was refused. A CSAM
 * match is refused exactly like content the classifier refused ("not_allowed"); the escalation is
 * raised by the pipeline, never visibly to the uploader.
 */
export const checkBoxArt = async (
  ctx: ActionCtx,
  storageId: Id<"_storage">,
): Promise<Id<"_storage">> => {
  const imageId = await ctx.runMutation(
    internal.catalog.boxArtModerationStore.claimUpload,
    { storageId },
  );
  if (!imageId) {
    throw new ConvexError({
      code: "InvalidUpload",
      message: "This upload can't be used",
    });
  }
  await runImageModeration(ctx, steps, { imageId, attempt: 1 });
  const row = await ctx.runQuery(
    internal.catalog.boxArtModerationStore.getForModeration,
    { imageId },
  );
  if (!row || row.moderationStatus === "quarantined") {
    throw boxArtRefused("not_allowed");
  }
  if (row.moderationStatus === "rejected") throw boxArtRefused(refusalOf(row));
  return row.fileId;
};
