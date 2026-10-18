import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { isBlockedEitherWay } from "../social/blocks";
import { isDeliverable } from "./messageAttachments";
import { threadRowByAggregateId } from "./readModelHelpers";

// "Show" on a blurred message photo (spec R.2): the thread read carries no URL for a blurred
// photo, so the tap fetches it here. Same gates as serving it at all: a participant of its thread,
// a delivered, deliverable, hash-cleared photo whose message wasn't removed, and the pair not
// blocked either way; anything else is the same generic AttachmentNotFound. Rate limited. The
// reveal is recorded for this viewer, so later reads serve the photo to them directly.
export const revealMessageImage = mutation({
  args: { attachmentId: v.id("messageAttachments") },
  handler: async (ctx, { attachmentId }): Promise<{ url: string }> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const notFound = () =>
      new ConvexError({
        code: "AttachmentNotFound",
        message: "Photo not found",
      });
    const row = await ctx.db.get(attachmentId);
    if (!row?.messageId || row.hiddenFromSender || !isDeliverable(row)) {
      throw notFound();
    }
    const messageId = row.messageId;
    const message = await ctx.db
      .query("threadMessages")
      .withIndex("by_message_id", (q) => q.eq("messageId", messageId))
      .first();
    const thread = await threadRowByAggregateId(ctx, row.threadAggregateId);
    if (
      !message ||
      message.removedAt !== undefined ||
      !thread?.participants.includes(me) ||
      (row.uploaderId !== me &&
        (await isBlockedEitherWay(ctx, me, row.uploaderId)))
    ) {
      throw notFound();
    }
    await enforceRateLimit(ctx, "imageReveal", me);
    const url = await ctx.storage.getUrl(row.fileId);
    if (url === null) throw notFound();
    const seen = await ctx.db
      .query("messageImageReveals")
      .withIndex("by_attachment_viewer", (q) =>
        q.eq("attachmentId", attachmentId).eq("viewerId", me),
      )
      .first();
    if (!seen) {
      await ctx.db.insert("messageImageReveals", {
        attachmentId,
        viewerId: me,
        revealedAt: Date.now(),
      });
    }
    return { url };
  },
});
