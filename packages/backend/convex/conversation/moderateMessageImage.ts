"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  imageModerationSteps,
  runHashRecheck,
  runImageModeration,
} from "../lib/imageModeration/pipeline";

// Screening for a staged message photo, on the shared image pipeline. Scheduled (runAfter 0) by
// stageMessageImage, which inserts the row as "pending". The message specifics (bands, the
// deferred append) live in conversation/attachmentModerationStore.
const steps = imageModerationSteps({
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
  retry: internal.conversation.moderateMessageImage.moderateMessageImage,
  recheck: internal.conversation.moderateMessageImage.recheckHashes,
});

export const moderateMessageImage = internalAction({
  args: {
    imageId: v.id("messageAttachments"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runImageModeration(ctx, steps, { imageId, attempt: attempt ?? 1 }),
});

export const recheckHashes = internalAction({
  args: {
    imageId: v.id("messageAttachments"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, attempt }): Promise<void> =>
    runHashRecheck(ctx, steps, { imageId, attempt: attempt ?? 1 }),
});
