import type {
  MessageAttachmentView,
  PendingAttachmentView,
} from "@jigswap/contracts";
import { makePostMessage, toMemberId, toThreadId } from "@jigswap/domain";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";
import { logEvent } from "../lib/logEvent";
import { readScreeningConfig } from "../library/adapters/photoModeration";
import { makeNotify } from "../notifications/adapters/makeNotify";
import { isBlockedEitherWay } from "../social/blocks";
import { areMutualFollowers } from "../social/privacy";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { threadRowByAggregateId } from "./readModelHelpers";

// Message image attachments (spec 2.1/2.2, R.1-R.3, R.10, R.12): the shared rules behind staging
// (stageMessageImage), sending (sendStagedImages), the pipeline's verdicts
// (attachmentModerationStore), the sender's outbox (listMyPendingAttachments), the appeal
// (requestImageReview, admin/decideImageReview) and the thread read model.
//
// DEFERRED APPEND: a photo becomes a thread message only once it is deliverable (approved,
// blurred or unscored-after-retries, AND its CSAM hash check has passed) AND its send was
// requested. Then exactly one image message is appended per photo through the domain's
// PostMessage use case, with the uploader as author and `sentAt` = the delivery time. So
// threads.lastMessage, unread counts and the MessagePosted notification only ever see delivered
// photos, with no per-viewer filtering, and rejected or quarantined photos never become messages.

/** Largest upload accepted for a message photo. */
export const MESSAGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** An upload must be claimed (staged) within this long of its creation. */
export const MESSAGE_IMAGE_CLAIM_WINDOW_MS = 15 * 60_000;
/** The client-reported pixel size must lie within 1..this on each side. */
export const MESSAGE_IMAGE_MAX_DIMENSION = 10_000;
/** The content types a message photo may be uploaded as (jimp decodes both). */
export const MESSAGE_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
];
/** Photos per send (spec R.3). */
export const MAX_PHOTOS_PER_SEND = 4;
/** A staged photo whose send was never requested is deleted after this long. */
export const STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60_000;
/**
 * Scores from here up to the reject threshold (MODERATION_NSFW_THRESHOLD, default 0.85) deliver
 * the photo blurred ("sensitive content"): fine-art puzzles produce false positives (spec 2.2).
 */
export const MESSAGE_IMAGE_BLUR_THRESHOLD = 0.5;
/** The audit label of a message photo (no content, no participants). */
export const MESSAGE_PHOTO_LABEL = "Message photo";

type Attachment = Doc<"messageAttachments">;
type Status = Attachment["moderationStatus"];

/** Feature gate (spec R.12): no configured classifier means no message photos at all. */
export const assertImagesAvailable = (): void => {
  if (readScreeningConfig(process.env).status !== "ok") {
    throw new ConvexError({
      code: "ImagesUnavailable",
      message: "Photos can't be sent right now",
    });
  }
};

/** The participant check every attachment mutation shares; the thread row when it passes. */
export const participantThreadOf = async (
  ctx: QueryCtx,
  threadId: string,
  memberId: Id<"users">,
): Promise<Doc<"threads">> => {
  const thread = await threadRowByAggregateId(ctx, threadId);
  if (!thread) {
    throw new ConvexError({
      code: "ThreadNotFound",
      message: "Thread not found",
    });
  }
  if (!thread.participants.includes(memberId)) {
    throw new ConvexError({
      code: "NotParticipant",
      message: "Only participants may post to a thread",
    });
  }
  return thread;
};

const DELIVERABLE: ReadonlySet<Status> = new Set([
  "approved",
  "blurred",
  "unscored",
]);
// States a photo never leaves on its own: it will not be delivered (an admin restore aside).
const UNDELIVERABLE: ReadonlySet<Status> = new Set([
  "rejected",
  "quarantined",
  "removed",
]);

/** Whether the photo may be delivered and served: a deliverable verdict AND a passed hash check. */
export const isDeliverable = (row: Attachment): boolean =>
  DELIVERABLE.has(row.moderationStatus) && row.hashCheckedAt !== undefined;

/**
 * Delete a photo's blobs, unless they must be kept: an open report's evidence hold, or a CSAM
 * escalation's preserved blob. Tolerates blobs that are already gone.
 */
export const deleteAttachmentBlobs = async (
  ctx: MutationCtx,
  row: Attachment,
): Promise<void> => {
  if (row.evidenceHold) return;
  for (const fileId of [row.fileId, row.thumbFileId]) {
    if (!fileId || !(await ctx.db.system.get(fileId))) continue;
    if (await isPreservedBlob(ctx, fileId)) continue;
    await ctx.storage.delete(fileId);
  }
};

/**
 * Clear a photo's evidence hold once no OPEN report references it any more (a report on the photo
 * itself, or on its image message). Called when a report is decided.
 */
export const releaseEvidenceHold = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
): Promise<void> => {
  const row = await ctx.db.get(attachmentId);
  if (!row?.evidenceHold) return;
  const targets: [Doc<"reports">["targetKind"], string][] = [
    ["attachment", row._id as string],
    ...(row.messageId !== undefined
      ? [["message", row.messageId] as [Doc<"reports">["targetKind"], string]]
      : []),
  ];
  for (const [targetKind, targetId] of targets) {
    const open = await ctx.db
      .query("reports")
      .withIndex("by_target", (q) =>
        q.eq("targetKind", targetKind).eq("targetId", targetId),
      )
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (open) return;
  }
  await ctx.db.patch(attachmentId, {
    evidenceHold: undefined,
    updatedAt: Date.now(),
  });
};

// Drop a photo that will never be delivered (expired, or its pair is now blocked): blobs and row.
// A quarantined or evidence-held row is kept whole.
const discardAttachment = async (ctx: MutationCtx, row: Attachment) => {
  if (row.moderationStatus === "quarantined" || row.evidenceHold) return;
  await deleteAttachmentBlobs(ctx, row);
  await ctx.db.delete(row._id);
};

// Append the photo's image message through the domain path (participant rule, caption rule, the
// MessagePosted event), authored by the uploader, at the current instant.
const appendMessage = async (
  ctx: MutationCtx,
  row: Attachment,
  caption: string,
): Promise<string | null> => {
  const post = makePostMessage({
    threads: convexThreadRepository(ctx),
    messageIds: messageIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });
  const result = await post({
    threadId: toThreadId(row.threadAggregateId),
    authorId: toMemberId(row.uploaderId as string),
    kind: "image",
    body: caption,
    attachmentRef: row._id as string,
  });
  if (result.isErr) {
    // E.g. the uploader left the thread. The photo stays undelivered (outbox: pending).
    logEvent({
      event: "conversation.deliverAttachment",
      outcome: "error",
      attachment_id: row._id,
      error_code: result.error.code,
    });
    return null;
  }
  return result.value as string;
};

// The sender learns of a rejection once it is final and they asked to send it: an in-app DSA
// Art. 17 statement of reasons that names the automated check and offers a review. A quarantined
// photo gets the IDENTICAL generic notice: its absence would tell the sender that a hash list
// matched (the tip-off lib/imageModeration/quarantine guards against). The notice names neither.
const notifyRejection = async (ctx: MutationCtx, row: Attachment) => {
  if (
    (row.moderationStatus !== "rejected" &&
      row.moderationStatus !== "quarantined") ||
    row.rejectionNotifiedAt
  ) {
    return;
  }
  await makeNotify(ctx)({
    memberId: toMemberId(row.uploaderId as string),
    type: "message_image_rejected",
    relatedId: row.threadAggregateId,
    params: {
      reason:
        "Our automated check flagged this photo, so it was not delivered.",
      automated: "true",
      redress: "Open the conversation and choose Ask for a review",
    },
  });
  await ctx.db.patch(row._id, { rejectionNotifiedAt: Date.now() });
};

/**
 * Advance the send batch `row` belongs to. Called after every state change of a photo (staging
 * verdicts, hash-check clears, the send request, an admin restore); a photo whose send was not
 * requested yet is left alone. In batch order: delivered photos are skipped, undeliverable ones
 * (rejected / quarantined / removed) are passed over, a deliverable one is appended, and the walk
 * stops at the first photo still being checked, so photos arrive in the order they were sent. The
 * first appender wins (`messageId`), which makes repeated calls no-ops. A caption is delivered only
 * with its photo: the caption of a photo that never delivers never reaches anyone. A blocked pair
 * gets nothing: undelivered photos are dropped.
 */
export const settleSendBatch = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
): Promise<void> => {
  const anchor = await ctx.db.get(attachmentId);
  if (!anchor || anchor.sendRequestedAt === undefined) return;
  const batch = (
    await ctx.db
      .query("messageAttachments")
      .withIndex("by_thread_uploader", (q) =>
        q
          .eq("threadAggregateId", anchor.threadAggregateId)
          .eq("uploaderId", anchor.uploaderId),
      )
      .collect()
  )
    .filter((row) => row.sendRequestedAt === anchor.sendRequestedAt)
    .sort((a, b) => (a.sendIndex ?? 0) - (b.sendIndex ?? 0));

  const thread = await threadRowByAggregateId(ctx, anchor.threadAggregateId);
  const blocked =
    thread !== null &&
    (
      await Promise.all(
        thread.participants
          .filter((p) => p !== anchor.uploaderId)
          .map((p) => isBlockedEitherWay(ctx, anchor.uploaderId, p)),
      )
    ).some(Boolean);
  if (blocked) {
    // Messages that will never be delivered are not stored (spec 2.6). A photo still in the
    // pipeline is dropped by the settle after its verdict, so its blobs are never orphaned.
    for (const row of batch) {
      if (row.messageId === undefined && row.moderationStatus !== "pending") {
        await discardAttachment(ctx, row);
      }
    }
    return;
  }
  for (const row of batch) await notifyRejection(ctx, row);

  for (const row of batch) {
    if (row.messageId !== undefined) continue;
    if (UNDELIVERABLE.has(row.moderationStatus)) continue;
    if (!isDeliverable(row)) return;
    const messageId = await appendMessage(ctx, row, row.caption ?? "");
    if (messageId === null) return;
    await ctx.db.patch(row._id, { messageId, updatedAt: Date.now() });
  }
};

/**
 * Expire a staged photo (scheduled at staging, STAGED_ATTACHMENT_TTL_MS later): deleted with its
 * blobs unless it was sent (or its send is in progress), is held for an appeal (rejected: kept for
 * the retention window), is quarantined, or is evidence for a report.
 */
export const expireStagedAttachment = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
): Promise<void> => {
  const row = await ctx.db.get(attachmentId);
  if (
    !row ||
    row.messageId !== undefined ||
    row.sendRequestedAt !== undefined ||
    row.moderationStatus === "rejected"
  ) {
    return;
  }
  await discardAttachment(ctx, row);
};

/**
 * Per-request resolver from an image message's attachment id to the viewer's attachment view.
 * URLs only for a deliverable, hash-cleared photo; never for a quarantined, rejected or removed
 * one. "blurred" is per viewer: the sensitive band, "not checked" (unscored), a sender who is not
 * the viewer's mutual follower (spec R.2), or a photo (or its message) the viewer has an open
 * report on. A blurred
 * view carries NO URL (only the blurhash and size): the viewer gets it by tapping Show
 * (revealMessageImage), after which the photo is served to them directly (`revealed`), except
 * while they have an open report on it. The uploader sees their own photo unblurred. Callers have
 * already checked participation.
 */
export const messageAttachmentViews = (ctx: QueryCtx, viewer: Id<"users">) => {
  const mutualWith = new Map<Id<"users">, Promise<boolean>>();
  const isMutual = (uploader: Id<"users">) => {
    let known = mutualWith.get(uploader);
    if (!known) {
      known = areMutualFollowers(ctx, viewer, uploader);
      mutualWith.set(uploader, known);
    }
    return known;
  };
  return async (
    attachmentId: Id<"messageAttachments">,
  ): Promise<MessageAttachmentView> => {
    const row = await ctx.db.get(attachmentId);
    if (!row) return { status: "removed" };
    const size = {
      ...(row.width !== undefined && { w: row.width }),
      ...(row.height !== undefined && { h: row.height }),
    };
    if (!isDeliverable(row)) {
      // Removed keeps its placeholder; rejected/quarantined (never appended, so only reachable
      // through corrupt data) show nothing at all.
      return row.moderationStatus === "removed"
        ? {
            status: "removed",
            ...size,
            ...(row.blurhash !== undefined && { blurhash: row.blurhash }),
          }
        : { status: "removed" };
    }
    const notChecked = row.moderationStatus === "unscored";
    const placeholder = {
      ...size,
      ...(row.blurhash !== undefined && { blurhash: row.blurhash }),
      ...(notChecked && { notChecked: true as const }),
    };
    let revealed = false;
    if (row.uploaderId !== viewer) {
      if (await hasOpenReport(ctx, viewer, row)) {
        return { status: "blurred", ...placeholder };
      }
      const blurred =
        row.moderationStatus !== "approved" ||
        !(await isMutual(row.uploaderId));
      if (blurred) {
        revealed = await hasRevealed(ctx, viewer, row._id);
        if (!revealed) return { status: "blurred", ...placeholder };
      }
    }
    const url = await ctx.storage.getUrl(row.fileId);
    const thumbUrl = row.thumbFileId
      ? await ctx.storage.getUrl(row.thumbFileId)
      : null;
    return {
      status: "ready",
      ...(url !== null && { url }),
      ...(thumbUrl !== null && { thumbUrl }),
      ...placeholder,
      ...(revealed && { revealed: true as const }),
    };
  };
};

const hasRevealed = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  attachmentId: Id<"messageAttachments">,
): Promise<boolean> =>
  (await ctx.db
    .query("messageImageReveals")
    .withIndex("by_attachment_viewer", (q) =>
      q.eq("attachmentId", attachmentId).eq("viewerId", viewerId),
    )
    .first()) !== null;

// An open report by this viewer on the photo, or on the image message carrying it.
const hasOpenReport = async (
  ctx: QueryCtx,
  reporterId: Id<"users">,
  row: Attachment,
): Promise<boolean> => {
  const targets: [Doc<"reports">["targetKind"], string][] = [
    ["attachment", row._id as string],
    ...(row.messageId !== undefined
      ? [["message", row.messageId] as [Doc<"reports">["targetKind"], string]]
      : []),
  ];
  for (const [targetKind, targetId] of targets) {
    const open = await ctx.db
      .query("reports")
      .withIndex("by_reporter_target", (q) =>
        q
          .eq("reporterId", reporterId)
          .eq("targetKind", targetKind)
          .eq("targetId", targetId),
      )
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (open) return true;
  }
  return false;
};

/**
 * The uploader's outbox view of one undelivered photo. A quarantined photo is shown exactly like
 * a photo the classifier flagged (rejected, reason "flagged", no image): nothing tells them apart.
 * The sender's own image is served only once its hash check has passed, otherwise its blurhash
 * (when the re-encode produced one); a rejected photo shows neither.
 */
export const pendingAttachmentViewOf = async (
  ctx: QueryCtx,
  row: Attachment,
): Promise<PendingAttachmentView> => {
  const base = {
    attachmentId: row._id as string,
    sendRequested: row.sendRequestedAt !== undefined,
    ...(row.width !== undefined && { w: row.width }),
    ...(row.height !== undefined && { h: row.height }),
    createdAt: row.createdAt,
  };
  if (
    row.moderationStatus === "rejected" ||
    row.moderationStatus === "quarantined" ||
    row.moderationStatus === "removed"
  ) {
    const reviewDecided =
      row.moderationStatus === "rejected" && row.reviewDecidedAt !== undefined;
    return {
      ...base,
      status: "rejected",
      reason:
        row.moderationStatus === "rejected" &&
        row.moderationLabel === "invalid_image"
          ? "unreadable"
          : "flagged",
      ...(row.reviewRequestedAt !== undefined && {
        review: reviewDecided ? ("upheld" as const) : ("requested" as const),
      }),
    };
  }
  const url =
    row.hashCheckedAt !== undefined
      ? await ctx.storage.getUrl(row.thumbFileId ?? row.fileId)
      : null;
  return {
    ...base,
    status: "pending",
    ...(url !== null
      ? { thumbUrl: url }
      : row.blurhash !== undefined
        ? { blurhash: row.blurhash }
        : {}),
  };
};
