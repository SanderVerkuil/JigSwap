"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  imageModerationSteps,
  runHashRecheck,
  runModerationJob,
} from "../lib/imageModeration/pipeline";

// A circle icon through the shared image-moderation pipeline (lib/imageModeration/pipeline), with
// `circleIcons` as its store (sharing/circleIconModerationStore). Enqueued on the moderation
// Workpool (lib/imageModeration/moderationPool) by sharing/setCircleIcon, which inserts the row as
// "pending"; an admin's "Check again" enqueues it again.
const steps = imageModerationSteps({
  table: "circleIcon",
  event: "sharing.moderateCircleIcon",
  load: internal.sharing.circleIconModerationStore.getForModeration,
  describe: (row) => ({ circle_id: row.circleId, uploader_id: row.uploaderId }),
  setFile: internal.sharing.circleIconModerationStore.setFile,
  setVerdict: internal.sharing.circleIconModerationStore.setVerdict,
  quarantine: internal.sharing.circleIconModerationStore.quarantine,
  setHashCheck: internal.sharing.circleIconModerationStore.setHashCheck,
});

export const moderateCircleIcon = internalAction({
  // `pooled`: run by the moderation Workpool, which retries.
  args: {
    imageId: v.id("circleIcons"),
    pooled: v.optional(v.boolean()),
  },
  handler: async (ctx, { imageId, pooled }): Promise<void> =>
    runModerationJob(ctx, steps, { imageId, pooled: pooled ?? false }),
});

// Re-check the stored hashes of an icon whose CSAM hash check was unavailable: a job on the hash
// re-check Workpool (lib/imageModeration/hashRecheckPool), armed with its 1-based `attempt`.
export const recheckHashes = internalAction({
  args: {
    imageId: v.id("circleIcons"),
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
