import { ConvexError, v } from "convex/values";
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
// it now through the deferred append; "uphold" keeps the rejection and deletes the blob (unless a
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
      await ctx.db.patch(attachmentId, {
        moderationStatus: "approved",
        moderatedBy: adminId,
        reviewDecidedAt: now,
        updatedAt: now,
      });
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
