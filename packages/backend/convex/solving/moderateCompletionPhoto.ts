"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  imageModerationSteps,
  runHashRecheck,
  runModerationJob,
} from "../lib/imageModeration/pipeline";

// Async image moderation for an uploaded completion photo, on the `completionImages` sidecar
// table. Enqueued on the moderation Workpool by `attachCompletionPhotos`, which inserts the sidecar as
// `moderationStatus: "pending"`. The steps live in the shared pipeline
// (`lib/imageModeration/pipeline.ts`). Table specifics stay in `completionModerationStore`: the
// file swap also swaps the id inside the completions row's `photos` array, and a rejection also
// removes the photo from the completion, deletes the blob and stamps the audit trail.
const steps = imageModerationSteps({
  table: "completion",
  event: "solving.moderateCompletionPhoto",
  load: internal.solving.completionModerationStore.getImageForModeration,
  // Business context: which completion / who uploaded.
  describe: (row) => ({
    completion_id: row.completionId,
    uploader_id: row.uploaderId,
  }),
  setFile: internal.solving.completionModerationStore.setModerationFile,
  setVerdict: internal.solving.completionModerationStore.setModerationVerdict,
  quarantine: internal.solving.completionModerationStore.quarantineImage,
  setHashCheck: internal.solving.completionModerationStore.setHashCheck,
  recheck: internal.solving.moderateCompletionPhoto.recheckHashes,
});

export const moderateCompletionPhoto = internalAction({
  // `pooled`: run by the moderation Workpool (lib/imageModeration/moderationPool), which retries.
  // `attempt` is no longer read (the row counts attempts); it is accepted so a retry scheduled
  // before the pool existed still runs, and hands its retries to the pool.
  args: {
    imageId: v.id("completionImages"),
    pooled: v.optional(v.boolean()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, pooled }): Promise<void> =>
    runModerationJob(ctx, steps, { imageId, pooled: pooled ?? false }),
});

// Re-check the stored hashes of a photo whose CSAM hash check was unavailable (backoff).
export const recheckHashes = internalAction({
  args: { imageId: v.id("completionImages"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runHashRecheck(ctx, steps, { imageId, attempt: attempt ?? 1 }),
});
