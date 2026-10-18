import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";
import { enforceRateLimit } from "../lib/rateLimits";
import { assertThreadNotBlocked } from "../social/blocks";
import {
  assertImagesAvailable,
  MESSAGE_IMAGE_CLAIM_WINDOW_MS,
  MESSAGE_IMAGE_MAX_BYTES,
  MESSAGE_IMAGE_MAX_DIMENSION,
  MESSAGE_IMAGE_TYPES,
  participantThreadOf,
  STAGED_ATTACHMENT_TTL_MS,
} from "./messageAttachments";

const refuse = (code: string, message: string) =>
  new ConvexError({ code, message });

const isDimension = (n: number) =>
  Number.isInteger(n) && n >= 1 && n <= MESSAGE_IMAGE_MAX_DIMENSION;

// Claim an uploaded blob as a staged message photo (spec 2.2). Same gates as the upload URL
// (participant, not blocked, photos available, rate limited), then the blob itself: it exists,
// is at most MESSAGE_IMAGE_MAX_BYTES, of an allowed type, uploaded less than
// MESSAGE_IMAGE_CLAIM_WINDOW_MS ago, and neither claimed already (first claimer wins) nor a blob
// preserved for a CSAM escalation; a missing, claimed or preserved blob is the same generic
// InvalidUpload. `width`/`height` are the client's pixel size, for layout only. The row starts
// "pending" and unpublished (hash gate), the shared pipeline is scheduled, and so is the 24 h
// expiry of a photo that is never sent. Returns the attachment id.
export const stageMessageImage = mutation({
  args: {
    threadId: v.string(),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"messageAttachments">> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    assertImagesAvailable();
    await participantThreadOf(ctx, args.threadId, me);
    await assertThreadNotBlocked(ctx, args.threadId, me);
    await enforceRateLimit(ctx, "imageStage", me);

    if (!isDimension(args.width) || !isDimension(args.height)) {
      throw refuse("InvalidImageSize", "The photo's size is not valid");
    }
    const blob = await ctx.db.system.get(args.storageId);
    const claimed = await ctx.db
      .query("messageAttachments")
      .withIndex("by_file", (q) => q.eq("fileId", args.storageId))
      .first();
    if (!blob || claimed || (await isPreservedBlob(ctx, args.storageId))) {
      throw refuse("InvalidUpload", "This upload can't be used");
    }
    const now = Date.now();
    if (now - blob._creationTime > MESSAGE_IMAGE_CLAIM_WINDOW_MS) {
      throw refuse("UploadExpired", "This upload has expired");
    }
    if (blob.size > MESSAGE_IMAGE_MAX_BYTES) {
      throw refuse("ImageTooLarge", "This photo is too large");
    }
    const contentType = blob.contentType ?? "";
    if (!MESSAGE_IMAGE_TYPES.includes(contentType)) {
      throw refuse("UnsupportedImageType", "This file type isn't supported");
    }

    const attachmentId = await ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: args.threadId,
      uploaderId: me,
      fileId: args.storageId,
      width: args.width,
      height: args.height,
      byteSize: blob.size,
      contentType,
      moderationStatus: "pending",
      hashCheckPendingSince: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.conversation.moderateMessageImage.moderateMessageImage,
      { imageId: attachmentId },
    );
    await ctx.scheduler.runAfter(
      STAGED_ATTACHMENT_TTL_MS,
      internal.conversation.attachmentModerationStore.expireStaged,
      { attachmentId },
    );
    return attachmentId;
  },
});
