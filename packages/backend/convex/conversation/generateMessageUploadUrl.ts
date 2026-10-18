import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { assertThreadNotBlocked } from "../social/blocks";
import {
  assertImagesAvailable,
  participantThreadOf,
} from "./messageAttachments";

// An upload URL for a message photo (spec 2.2): a participant of the thread, the pair not blocked
// either way (CannotReply), photos available (ImagesUnavailable when no classifier is configured:
// no screening means no DM photos, spec R.12), and rate limited. The upload is claimed afterwards
// by stageMessageImage, which checks the blob itself.
export const generateMessageUploadUrl = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<string> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    assertImagesAvailable();
    await participantThreadOf(ctx, threadId, me);
    await assertThreadNotBlocked(ctx, threadId, me);
    await enforceRateLimit(ctx, "imageUploadUrl", me);
    return ctx.storage.generateUploadUrl();
  },
});
