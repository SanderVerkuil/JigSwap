import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation, type QueryCtx } from "../_generated/server";
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

// Whether any table already references the blob (a copy photo, a completion photo, a message
// photo, a puzzle's box art) or a CSAM escalation preserves it: such a blob is never claimed and
// never deleted here.
const isReferenced = async (
  ctx: QueryCtx,
  storageId: Id<"_storage">,
): Promise<boolean> => {
  const byFile = (
    table: "ownedPuzzleImages" | "completionImages" | "messageAttachments",
  ) =>
    ctx.db
      .query(table)
      .withIndex("by_file", (q) => q.eq("fileId", storageId))
      .first();
  return (
    (await byFile("messageAttachments")) !== null ||
    (await byFile("ownedPuzzleImages")) !== null ||
    (await byFile("completionImages")) !== null ||
    (await ctx.db
      .query("puzzles")
      .withIndex("by_image", (q) => q.eq("image", storageId))
      .first()) !== null ||
    (await isPreservedBlob(ctx, storageId))
  );
};

export type StageResult =
  | { attachmentId: Id<"messageAttachments"> }
  | { refused: "ImageTooLarge" | "UnsupportedImageType" | "UploadExpired" };

// Claim an uploaded blob as a staged message photo (spec 2.2). Same gates as the upload URL
// (participant, not blocked, photos available, both stage rate limits), then the blob: it exists
// and nothing references it yet (not a copy, completion or message photo, not box art, not
// CSAM-preserved; else the generic InvalidUpload, and it is left alone). The CONTENT checks
// (at most MESSAGE_IMAGE_MAX_BYTES, an allowed type, uploaded within
// MESSAGE_IMAGE_CLAIM_WINDOW_MS) return `{ refused }` instead of throwing, so that a refused
// fresh upload is deleted for good (a throw would roll the delete back). A stale blob is refused
// but NOT deleted: it may be referenced where no index can tell (legacy completion photos), and
// deleting on request would let anyone destroy it. Magic bytes are checked by the pipeline (a
// mutation can't read the bytes): a mismatch is rejected there as an unreadable upload.
// `width`/`height` are the client's pixel size, for layout only. The row starts "pending" and
// unpublished (hash gate), the shared pipeline is scheduled, and so is the 24 h expiry of a photo
// that is never sent.
export const stageMessageImage = mutation({
  args: {
    threadId: v.string(),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args): Promise<StageResult> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    assertImagesAvailable();
    await participantThreadOf(ctx, args.threadId, me);
    await assertThreadNotBlocked(ctx, args.threadId, me);
    await enforceRateLimit(ctx, "imageStage", me);
    await enforceRateLimit(ctx, "imageStageDaily", me);

    if (!isDimension(args.width) || !isDimension(args.height)) {
      throw refuse("InvalidImageSize", "The photo's size is not valid");
    }
    const blob = await ctx.db.system.get(args.storageId);
    if (!blob || (await isReferenced(ctx, args.storageId))) {
      throw refuse("InvalidUpload", "This upload can't be used");
    }
    const now = Date.now();
    if (now - blob._creationTime > MESSAGE_IMAGE_CLAIM_WINDOW_MS) {
      return { refused: "UploadExpired" };
    }
    const contentType = blob.contentType ?? "";
    const refusal =
      blob.size > MESSAGE_IMAGE_MAX_BYTES
        ? ("ImageTooLarge" as const)
        : !MESSAGE_IMAGE_TYPES.includes(contentType)
          ? ("UnsupportedImageType" as const)
          : null;
    if (refusal) {
      await ctx.storage.delete(args.storageId);
      return { refused: refusal };
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
    return { attachmentId };
  },
});
