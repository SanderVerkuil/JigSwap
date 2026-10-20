"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  imageModerationSteps,
  runHashRecheck,
  runModerationJob,
} from "../lib/imageModeration/pipeline";

// Screening for a staged message photo, on the shared image pipeline. Enqueued on the moderation
// Workpool (lib/imageModeration/moderationPool) by stageMessageImage, which inserts the row as
// "pending". The message specifics (bands, the deferred append) live in
// conversation/attachmentModerationStore.
const steps = imageModerationSteps({
  table: "message",
  event: "conversation.moderateMessageImage",
  load: internal.conversation.attachmentModerationStore.getImageForModeration,
  describe: (row) => ({
    thread_id: row.threadAggregateId,
    uploader_id: row.uploaderId,
  }),
  setFile: internal.conversation.attachmentModerationStore.setModerationFile,
  setVerdict:
    internal.conversation.attachmentModerationStore.setModerationVerdict,
  quarantine: internal.conversation.attachmentModerationStore.quarantineImage,
  setHashCheck: internal.conversation.attachmentModerationStore.setHashCheck,
});

export const moderateMessageImage = internalAction({
  // `pooled`: run by the moderation Workpool (lib/imageModeration/moderationPool), which retries.
  // `attempt` is no longer read (the row counts attempts); it is accepted so a retry scheduled
  // before the pool existed still runs, and hands its retries to the pool.
  args: {
    imageId: v.id("messageAttachments"),
    pooled: v.optional(v.boolean()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, pooled }): Promise<void> =>
    runModerationJob(ctx, steps, { imageId, pooled: pooled ?? false }),
});

// Re-check the stored hashes of a photo whose CSAM hash check was unavailable: a job on the hash
// re-check Workpool (lib/imageModeration/hashRecheckPool), armed with its 1-based `attempt`.
// Without `pooled` it is a re-check scheduled before the pool existed: it still runs, and hands
// the next attempt to the pool.
export const recheckHashes = internalAction({
  args: {
    imageId: v.id("messageAttachments"),
    attempt: v.optional(v.number()),
    pooled: v.optional(v.boolean()),
  },
  handler: async (ctx, { imageId, attempt, pooled }): Promise<void> =>
    runHashRecheck(ctx, steps, {
      imageId,
      attempt: attempt ?? 1,
      pooled: pooled ?? false,
    }),
});
