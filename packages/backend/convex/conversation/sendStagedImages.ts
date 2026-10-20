import { MAX_CAPTION_LENGTH } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { assertThreadNotBlocked } from "../social/blocks";
import {
  asImage,
  MAX_PHOTOS_PER_SEND,
  participantThreadOf,
  settleSendBatch,
} from "./messageAttachments";
import { deleteTypingRowOf } from "./typingIndicators";

const notFound = () =>
  new ConvexError({ code: "AttachmentNotFound", message: "Photo not found" });

// Send up to MAX_PHOTOS_PER_SEND of the caller's staged photos in this thread, in the given
// order, with an optional caption on the LAST one (spec R.3). Each photo becomes its own image
// message right away, in this order, whether or not its check has finished (spec 2026-10-20: the
// recipient sees "Pending review" until it may be served, messageAttachments.ts); a photo the
// check already stopped is passed over. Every photo must be the caller's, staged in
// this thread and not sent yet; anything else is the same generic AttachmentNotFound, so the
// result never tells a rejected or quarantined photo from a missing one (a quarantined photo
// hidden from its sender answers exactly like a deleted rejected one). Sending clears the
// caller's typing row (they typed the caption), as postMessage does.
export const sendStagedImages = mutation({
  args: {
    threadId: v.string(),
    attachmentIds: v.array(v.id("messageAttachments")),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    await enforceRateLimit(ctx, "messagePost", me);
    await participantThreadOf(ctx, args.threadId, me);
    await assertThreadNotBlocked(ctx, args.threadId, me);

    const ids = args.attachmentIds;
    if (
      ids.length === 0 ||
      ids.length > MAX_PHOTOS_PER_SEND ||
      new Set(ids).size !== ids.length
    ) {
      throw new ConvexError({
        code: "InvalidAttachmentCount",
        message: `Send 1 to ${MAX_PHOTOS_PER_SEND} photos at a time`,
      });
    }
    const caption = args.caption?.trim() || undefined;
    if (caption !== undefined && caption.length > MAX_CAPTION_LENGTH) {
      throw new ConvexError({
        code: "CaptionTooLong",
        message: `A caption must be at most ${MAX_CAPTION_LENGTH} characters`,
      });
    }
    const rows = [];
    for (const id of ids) {
      const row = asImage(await ctx.db.get(id));
      if (
        !row ||
        row.hiddenFromSender ||
        row.uploaderId !== me ||
        row.threadAggregateId !== args.threadId ||
        row.sendRequestedAt !== undefined ||
        row.messageId !== undefined
      ) {
        throw notFound();
      }
      rows.push(row);
    }

    // The request instant keys the batch, so it must not collide with an earlier batch of this
    // sender in this thread (two sends within one millisecond).
    const used = new Set(
      (
        await ctx.db
          .query("messageAttachments")
          .withIndex("by_thread_uploader", (q) =>
            q.eq("threadAggregateId", args.threadId).eq("uploaderId", me),
          )
          .collect()
      ).map((row) => (row.kind === "image" ? row.sendRequestedAt : undefined)),
    );
    let sendRequestedAt = Date.now();
    while (used.has(sendRequestedAt)) sendRequestedAt += 1;

    for (const [sendIndex, row] of rows.entries()) {
      await ctx.db.patch(row._id, {
        sendRequestedAt,
        sendIndex,
        ...(sendIndex === rows.length - 1 && caption !== undefined
          ? { caption }
          : {}),
        updatedAt: Date.now(),
      });
    }
    await settleSendBatch(ctx, rows[0]._id);
    await deleteTypingRowOf(ctx, args.threadId, me);
  },
});
