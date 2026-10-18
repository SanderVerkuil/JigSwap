import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// "Ask for a review" on one of the caller's photos the automated check stopped (spec 2.2, R.10):
// only now may an admin see it (admin/listImageReviewRequests). Idempotent. A quarantined photo
// takes the request exactly like a rejected one (the sender can't tell them apart), but it never
// reaches the admin queue: nobody may view it.
export const requestImageReview = mutation({
  args: { attachmentId: v.id("messageAttachments") },
  handler: async (ctx, { attachmentId }): Promise<void> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const row = await ctx.db.get(attachmentId);
    if (
      !row ||
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
  },
});
