"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  imageModerationSteps,
  runHashRecheck,
  runModerationJob,
} from "../lib/imageModeration/pipeline";

// Async image moderation for an uploaded copy photo. Enqueued on the moderation Workpool
// (lib/imageModeration/moderationPool) by `addCopyPhoto`, which inserts the row as `moderationStatus: "pending"`. The steps (input guards, re-encode /
// EXIF strip, blurhash, CSAM hash check, classify, verdict, retries, wide event) live in the
// shared pipeline (`lib/imageModeration/pipeline.ts`); this module only names the
// `ownedPuzzleImages` store.
const steps = imageModerationSteps({
  table: "copy",
  event: "library.moderatePhoto",
  load: internal.library.moderationStore.getImageForModeration,
  // Business context: which copy / who uploaded / what kind of shot.
  describe: (row) => ({
    copy_id: row.ownedPuzzleId,
    uploader_id: row.uploaderId,
    photo_tag: row.tag ?? null,
  }),
  setFile: internal.library.moderationStore.setModerationFile,
  setVerdict: internal.library.moderationStore.setModerationVerdict,
  quarantine: internal.library.moderationStore.quarantineImage,
  setHashCheck: internal.library.moderationStore.setHashCheck,
  recheck: internal.library.moderatePhoto.recheckHashes,
});

export const moderatePhoto = internalAction({
  // `pooled`: run by the moderation Workpool (lib/imageModeration/moderationPool), which retries.
  // `attempt` is no longer read (the row counts attempts); it is accepted so a retry scheduled
  // before the pool existed still runs, and hands its retries to the pool.
  args: {
    imageId: v.id("ownedPuzzleImages"),
    pooled: v.optional(v.boolean()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, pooled }): Promise<void> =>
    runModerationJob(ctx, steps, { imageId, pooled: pooled ?? false }),
});

// Re-check the stored hashes of a photo whose CSAM hash check was unavailable (backoff).
export const recheckHashes = internalAction({
  args: { imageId: v.id("ownedPuzzleImages"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runHashRecheck(ctx, steps, { imageId, attempt: attempt ?? 1 }),
});
