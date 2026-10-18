"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { runImageModeration } from "../lib/imageModeration/pipeline";

// Async image moderation for an uploaded copy photo. Scheduled (runAfter 0) by `addCopyPhoto`,
// which inserts the row as `moderationStatus: "pending"`. The steps (re-encode / EXIF strip,
// blurhash, classify, verdict, retries, wide event) live in the shared pipeline
// (`lib/imageModeration/pipeline.ts`); this action only names the `ownedPuzzleImages` store.
export const moderatePhoto = internalAction({
  // `attempt` is 1-based; absent = the first attempt (the upload's schedule).
  args: { imageId: v.id("ownedPuzzleImages"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runImageModeration(
      ctx,
      {
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
        retry: internal.library.moderatePhoto.moderatePhoto,
      },
      { imageId, attempt: attempt ?? 1 },
    ),
});
