import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// "Ask for a review" on one of the caller's photos the automated check stopped (spec 2.2, R.10):
// only now may an admin see it (admin/listImageReviewRequests). Idempotent. A quarantined photo
// takes the request exactly like a rejected one (the sender can't tell them apart), but it never
// reaches the admin queue: nobody may view it. So that it also ENDS like a rejected one, a flip
// after a randomised 24-72 h shows the sender "upheld" (showQuarantinedReviewUpheld).
export const requestImageReview = mutation({
  args: { attachmentId: v.id("messageAttachments") },
  handler: async (ctx, { attachmentId }): Promise<void> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const row = await ctx.db.get(attachmentId);
    if (
      !row ||
      row.hiddenFromSender ||
      row.uploaderId !== me ||
      row.messageId !== undefined ||
      (row.moderationStatus !== "rejected" &&
        row.moderationStatus !== "quarantined")
    ) {
      throw new ConvexError({
        code: "AttachmentNotFound",
        message: "Photo not found",
      });
    }
    if (row.reviewRequestedAt !== undefined) return;
    await ctx.db.patch(attachmentId, {
      reviewRequestedAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (row.moderationStatus === "quarantined") {
      await ctx.scheduler.runAfter(
        QUARANTINE_REVIEW_MIN_MS +
          Math.floor(Math.random() * QUARANTINE_REVIEW_SPREAD_MS),
        internal.conversation.requestImageReview.showQuarantinedReviewUpheld,
        { attachmentId },
      );
    }
  },
});

// A human review typically takes a day or more; the quarantine flip lands anywhere in 24-72 h.
const QUARANTINE_REVIEW_MIN_MS = 24 * 60 * 60_000;
const QUARANTINE_REVIEW_SPREAD_MS = 48 * 60 * 60_000;

// The sender-view-only end of a quarantined photo's review request: the outbox now shows
// "upheld". Nothing else changes: the row stays quarantined and preserved, no admin decided it.
export const showQuarantinedReviewUpheld = internalMutation({
  args: { attachmentId: v.id("messageAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const row = await ctx.db.get(attachmentId);
    if (row?.moderationStatus !== "quarantined" || row.senderReviewUpheldAt) {
      return;
    }
    await ctx.db.patch(attachmentId, { senderReviewUpheldAt: Date.now() });
  },
});
