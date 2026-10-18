import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import {
  deleteAttachmentBlobs,
  MESSAGE_PHOTO_LABEL,
  settleSendBatch,
} from "../conversation/messageAttachments";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { stampModerationAction } from "./stampModerationAction";

// An admin's decision on a sender's review request (listImageReviewRequests). "restore" approves
// the photo (moderatedBy: a manual decision is final) and, when its send was requested, delivers
// it now through the deferred append (a photo not yet re-encoded first goes back through the
// pipeline); "uphold" keeps the rejection and deletes the blob (unless a
// report holds it as evidence). Only a rejected photo awaiting review qualifies; a restore also
// needs a passed hash check and a blob still in storage. Both decisions are audit-stamped.
export const decideImageReview = mutation({
  args: {
    attachmentId: v.id("messageAttachments"),
    decision: v.union(v.literal("restore"), v.literal("uphold")),
  },
  handler: async (ctx, { attachmentId, decision }): Promise<void> => {
    const adminId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const row = await ctx.db.get(attachmentId);
    if (
      !row ||
      row.moderationStatus !== "rejected" ||
      row.reviewRequestedAt === undefined ||
      row.reviewDecidedAt !== undefined
    ) {
      throw new ConvexError({
        code: "NotAwaitingReview",
        message: "This photo is not awaiting a review",
      });
    }
    const now = Date.now();
    if (decision === "restore") {
      if (
        row.hashCheckedAt === undefined ||
        !(await ctx.db.system.get(row.fileId))
      ) {
        throw new ConvexError({
          code: "CannotRestore",
          message: "This photo can't be restored",
        });
      }
      // A photo never swapped to its re-encode (EXIF/GPS still in it) goes back through the
      // pipeline: it re-encodes, and the store keeps the admin's approval whatever the
      // classifier says (a manual decision is final). It is delivered once that completes.
      const reencoded = row.reencodedAt !== undefined;
      await ctx.db.patch(attachmentId, {
        moderationStatus: reencoded ? "approved" : "pending",
        moderatedBy: adminId,
        reviewDecidedAt: now,
        updatedAt: now,
      });
      if (!reencoded) {
        await ctx.scheduler.runAfter(
          0,
          internal.conversation.moderateMessageImage.moderateMessageImage,
          { imageId: attachmentId },
        );
      }
      await stampModerationAction(ctx, {
        actorId: adminId,
        kind: "message_image_restored",
        targetLabel: MESSAGE_PHOTO_LABEL,
        targetId: attachmentId,
      });
      await settleSendBatch(ctx, attachmentId);
      return;
    }
    await deleteAttachmentBlobs(ctx, row);
    await ctx.db.patch(attachmentId, {
      moderatedBy: adminId,
      reviewDecidedAt: now,
      updatedAt: now,
    });
    await stampModerationAction(ctx, {
      actorId: adminId,
      kind: "photo_removal_confirmed",
      targetLabel: MESSAGE_PHOTO_LABEL,
      targetId: attachmentId,
    });
  },
});
