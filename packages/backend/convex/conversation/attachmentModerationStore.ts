import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { INVALID_IMAGE_LABEL } from "../lib/imageModeration/guards";
import {
  applyHashCheckResult,
  hashCheckResultArgs,
  quarantineArgs,
  recordCsamEscalation,
} from "../lib/imageModeration/quarantine";
import {
  expireStagedAttachment,
  MESSAGE_IMAGE_BLUR_THRESHOLD,
  MESSAGE_PHOTO_LABEL,
  purgeUndeliveredAttachment,
  REJECTED_ATTACHMENT_TTL_MS,
  settleSendBatch,
} from "./messageAttachments";

// The `messageAttachments` store for the shared image pipeline (lib/imageModeration/pipeline),
// driven by conversation/moderateMessageImage. Thin like the library and completion stores, plus
// the two message-specific steps: verdicts map onto the message bands, and every verdict or
// hash-check clear advances the photo's send batch (the deferred append, messageAttachments.ts).

export const getImageForModeration = internalQuery({
  args: { imageId: v.id("messageAttachments") },
  handler: async (ctx, { imageId }) => {
    const row = await ctx.db.get(imageId);
    if (!row) return null;
    return {
      fileId: row.fileId,
      moderationStatus: row.moderationStatus,
      hashCheckedAt: row.hashCheckedAt,
      pendingHashes: row.pendingHashes,
      reencodedAt: row.reencodedAt,
      uploaderId: row.uploaderId,
      // Business context for the wide event: never the thread's content or the other member.
      threadAggregateId: row.threadAggregateId,
    };
  },
});

// Point the row at the re-encoded (EXIF-free) blob, store its blurhash and mark it re-encoded
// (the pipeline stops re-encoding, and the photo may now be delivered).
export const setModerationFile = internalMutation({
  args: {
    imageId: v.id("messageAttachments"),
    fileId: v.id("_storage"),
    blurhash: v.optional(v.string()),
  },
  handler: async (ctx, { imageId, fileId, blurhash }) => {
    if (!(await ctx.db.get(imageId))) return;
    const now = Date.now();
    await ctx.db.patch(imageId, {
      fileId,
      blurhash,
      reencodedAt: now,
      updatedAt: now,
    });
  },
});

// Record the classifier verdict, FIRST VERDICT WINS (pending rows only, so a double verdict is a
// no-op). Bands: an approval scored at or above MESSAGE_IMAGE_BLUR_THRESHOLD is delivered
// "blurred"; "unscored" (the retries ran out) is delivered blurred as "not checked"; "rejected" is
// never delivered: it is stamped for the audit trail and its blob is kept for an appeal.
export const setModerationVerdict = internalMutation({
  args: {
    imageId: v.id("messageAttachments"),
    moderationStatus: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("unscored"),
    ),
    moderationScore: v.optional(v.number()),
    moderationLabel: v.optional(v.string()),
    moderationReason: v.optional(v.string()),
    moderationAttempts: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, moderationStatus, ...verdict }) => {
    const row = await ctx.db.get(imageId);
    if (!row || row.moderationStatus !== "pending") return;
    // An admin restored this photo and sent it back only to be re-encoded: their approval is
    // final, unless the file itself turned out unreadable.
    const restored =
      row.moderatedBy !== undefined &&
      verdict.moderationLabel !== INVALID_IMAGE_LABEL;
    const status = restored
      ? "approved"
      : moderationStatus === "approved" &&
          (verdict.moderationScore ?? 0) >= MESSAGE_IMAGE_BLUR_THRESHOLD
        ? "blurred"
        : moderationStatus;
    await ctx.db.patch(imageId, {
      moderationStatus: status,
      ...verdict,
      updatedAt: Date.now(),
    });
    if (status === "rejected") {
      await ctx.scheduler.runAfter(
        REJECTED_ATTACHMENT_TTL_MS,
        internal.conversation.attachmentModerationStore.purgeUndelivered,
        { attachmentId: imageId, rule: "rejected" },
      );
      await stampModerationAction(ctx, {
        kind: "message_image_auto_rejected",
        targetLabel: MESSAGE_PHOTO_LABEL,
        targetId: imageId,
      });
    }
    await settleSendBatch(ctx, imageId);
  },
});

// A CSAM hash match: FORCE "quarantined" on the preserved blob and always escalate. The photo was
// never appended (appending needs a passed hash check), so no message references it. Its send
// batch is advanced like after a verdict (the sender's generic "not sent" notice).
export const quarantineImage = internalMutation({
  args: { imageId: v.id("messageAttachments"), ...quarantineArgs },
  handler: async (ctx, { imageId, ...match }) => {
    if (await ctx.db.get(imageId)) {
      // Same 30-day point as a rejection, where it is hidden (never deleted) from the sender.
      await ctx.scheduler.runAfter(
        REJECTED_ATTACHMENT_TTL_MS,
        internal.conversation.attachmentModerationStore.purgeUndelivered,
        { attachmentId: imageId, rule: "rejected" },
      );
      await ctx.db.patch(imageId, {
        moderationStatus: "quarantined",
        ...(match.fileId ? { fileId: match.fileId } : {}),
        pendingHashes: undefined,
        updatedAt: Date.now(),
      });
    }
    const escalationId = await recordCsamEscalation(ctx, {
      table: "messageAttachments",
      rowId: imageId,
      ...match,
    });
    // A sent photo's sender gets the same generic notice a rejection would give.
    await settleSendBatch(ctx, imageId);
    return escalationId;
  },
});

// Record the hash-check outcome; a clear may complete a delivery that only waited on it.
export const setHashCheck = internalMutation({
  args: { imageId: v.id("messageAttachments"), ...hashCheckResultArgs },
  handler: async (ctx, { imageId, ...result }) => {
    await applyHashCheckResult(ctx, imageId, result);
    if (result.status === "no_match") await settleSendBatch(ctx, imageId);
  },
});

// Scheduled at a verdict / the send request: purge a photo that was never delivered.
export const purgeUndelivered = internalMutation({
  args: {
    attachmentId: v.id("messageAttachments"),
    rule: v.union(v.literal("rejected"), v.literal("undelivered")),
  },
  handler: (ctx, { attachmentId, rule }) =>
    purgeUndeliveredAttachment(ctx, attachmentId, rule),
});

// Scheduled at staging: drop a photo that was never sent (messageAttachments.ts).
export const expireStaged = internalMutation({
  args: { attachmentId: v.id("messageAttachments") },
  handler: (ctx, { attachmentId }) => expireStagedAttachment(ctx, attachmentId),
});
