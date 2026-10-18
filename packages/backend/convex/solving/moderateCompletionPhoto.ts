"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { runImageModeration } from "../lib/imageModeration/pipeline";

// Async image moderation for an uploaded completion photo, on the `completionImages` sidecar
// table. Scheduled (runAfter 0) by `attachCompletionPhotos`, which inserts the sidecar as
// `moderationStatus: "pending"`. The steps live in the shared pipeline
// (`lib/imageModeration/pipeline.ts`). Table specifics stay in `completionModerationStore`: the
// file swap also swaps the id inside the completions row's `photos` array, and a rejection also
// removes the photo from the completion, deletes the blob and stamps the audit trail.
export const moderateCompletionPhoto = internalAction({
  // `attempt` is 1-based; absent = the first attempt (the upload's schedule).
  args: { imageId: v.id("completionImages"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runImageModeration(
      ctx,
      {
        event: "solving.moderateCompletionPhoto",
        load: internal.solving.completionModerationStore.getImageForModeration,
        // Business context: which completion / who uploaded.
        describe: (row) => ({
          completion_id: row.completionId,
          uploader_id: row.uploaderId,
        }),
        setFile: internal.solving.completionModerationStore.setModerationFile,
        setVerdict:
          internal.solving.completionModerationStore.setModerationVerdict,
        retry: internal.solving.moderateCompletionPhoto.moderateCompletionPhoto,
      },
      { imageId, attempt: attempt ?? 1 },
    ),
});
