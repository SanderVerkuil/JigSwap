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
import { participantsKeyOf } from "./adapters/threadMapper";
import { threadRowByAggregateId } from "./readModelHelpers";
import { isCurrentCircleMember } from "./threadMemberProjection";

// Message image attachments (spec 2.1/2.2, R.1-R.3, R.10, R.12): the shared rules behind staging
// (stageMessageImage), sending (sendStagedImages), the pipeline's verdicts
// (attachmentModerationStore), the sender's outbox (listMyPendingAttachments), the appeal
// (requestImageReview, admin/decideImageReview) and the thread read model.
//
// APPEND AT SEND (spec 2026-10-20-chat-photo-immediate-delivery): on Send, every photo of the
// batch that the check has not already stopped becomes one image message right away, in send
// order, through the domain's PostMessage use case (uploader as author, `sentAt` = the send time).
// So threads.lastMessage, unread counts and the MessagePosted notification see a photo when it is
// sent, like a text message. What a reader may SEE of it is decided per read
// (messageAttachmentViews): no recipient is ever served the image before it is servable
// (isServable: approved or blurred, hash-cleared, re-encoded); until then it is "pending", and a
// photo the check stops reads "removed" for them. A photo already stopped before Send is never
// appended (the sender's outbox keeps its refusal card).

/** Largest upload accepted for a message photo. */
export const MESSAGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** An upload must be claimed (staged) within this long of its creation. */
export const MESSAGE_IMAGE_CLAIM_WINDOW_MS = 15 * 60_000;
/** The client-reported pixel size must lie within 1..this on each side. */
export const MESSAGE_IMAGE_MAX_DIMENSION = 10_000;
/**
 * The content types a message photo may be uploaded as. jimp re-encodes JPEG and PNG; a WebP
 * (an original sent by a browser that blocks the client-side re-encode) is stored as its
 * metadata-stripped bytes, like other photo uploads.
 */
export const MESSAGE_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];
/** Photos per send (spec R.3). */
export const MAX_PHOTOS_PER_SEND = 4;
/** A staged photo whose send was never requested is deleted after this long. */
export const STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60_000;
/** A rejected photo nobody appealed is purged after this long (spec 2.8: 30 days for appeals). */
export const REJECTED_ATTACHMENT_TTL_MS = 30 * 24 * 60 * 60_000;
/**
 * Scores from here up to the reject threshold (MODERATION_NSFW_THRESHOLD, default 0.85) deliver
 * the photo blurred ("sensitive content"): fine-art puzzles produce false positives (spec 2.2).
 */
export const MESSAGE_IMAGE_BLUR_THRESHOLD = 0.5;
/** The audit label of a message photo (no content, no participants). */
export const MESSAGE_PHOTO_LABEL = "Message photo";

/** A message photo row (the image variant of messageAttachments). */
export type ImageAttachment = Extract<
  Doc<"messageAttachments">,
  { kind: "image" }
>;
/** A shared-location row (the location variant of messageAttachments). */
export type LocationAttachment = Extract<
  Doc<"messageAttachments">,
  { kind: "location" }
>;
type Attachment = ImageAttachment;
type Status = Attachment["moderationStatus"];

/** The row when it is a message photo; null otherwise (missing, or a location). */
export const asImage = (
  row: Doc<"messageAttachments"> | null,
): ImageAttachment | null => (row?.kind === "image" ? row : null);

/** The blobs a row serves: a photo and its thumbnail, or a location's map preview. */
const servedBlobsOf = (
  row: Doc<"messageAttachments">,
): (Id<"_storage"> | undefined)[] =>
  row.kind === "image" ? [row.fileId, row.thumbFileId] : [row.mapFileId];

/** Feature gate (spec R.12): no configured classifier means no message photos at all. */
export const assertImagesAvailable = (): void => {
  if (readScreeningConfig(process.env).status !== "ok") {
    throw new ConvexError({
      code: "ImagesUnavailable",
      message: "Photos can't be sent right now",
    });
  }
};

/**
 * The participant check every attachment mutation shares; the thread row when it passes. In a
 * circle thread the member must also still be in the circle (the participant set follows it
 * asynchronously), else the same NotParticipant.
 */
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
  if (
    !thread.participants.includes(memberId) ||
    (thread.subjectKind === "circle" &&
      (thread.circleId === undefined ||
        !(await isCurrentCircleMember(ctx, thread.circleId, memberId))))
  ) {
    throw new ConvexError({
      code: "NotParticipant",
      message: "Only participants may post to a thread",
    });
  }
  return thread;
};

// The verdicts that let a photo be shown to someone other than its sender. "unscored" (the check
// could not run) is NOT one: it waits for a moderator (admin/listUncheckedPhotos).
const SERVABLE: ReadonlySet<Status> = new Set(["approved", "blurred"]);
// States a photo never leaves on its own: never appended at Send, and "removed" for recipients
// (an admin restore aside).
const STOPPED: ReadonlySet<Status> = new Set([
  "rejected",
  "quarantined",
  "removed",
]);

/**
 * Whether an image message's caption is withheld from a reader other than its sender: its photo
 * is gone, hidden, or stopped (rejected, quarantined, removed by a moderator), exactly the photos
 * that read "Removed by moderation" for them (messageAttachmentViews). Rejected and quarantined
 * alike. A deleted sender's photo ("no longer available") keeps its caption, like their text
 * messages. Every recipient read of a caption checks this: the thread read model and the inbox
 * snippet. The sender always keeps their own caption.
 */
export const isCaptionWithheld = (
  row: Doc<"messageAttachments"> | null,
): boolean => {
  const image = asImage(row);
  if (!image || image.hiddenFromSender) return true;
  return (
    STOPPED.has(image.moderationStatus) &&
    image.removedReason !== "account_deleted"
  );
};

/**
 * Whether the photo may be served to a reader other than its sender: an approving verdict (incl.
 * the sensitive "blurred" band, which still needs Show), a passed CSAM hash check, and its blob
 * swapped to the pipeline's re-encode (never the upload as sent, with its EXIF/GPS). THE gate of
 * every recipient-facing read: the thread read model, revealMessageImage and attachment reports.
 */
export const isServable = (row: Attachment): boolean =>
  SERVABLE.has(row.moderationStatus) &&
  row.hashCheckedAt !== undefined &&
  row.reencodedAt !== undefined;

/**
 * Delete an attachment's served blobs (a photo's, or a location's map preview), unless they must
 * be kept: an open report's evidence hold, or a CSAM escalation's preserved blob. Tolerates blobs
 * that are already gone.
 */
export const deleteAttachmentBlobs = async (
  ctx: MutationCtx,
  row: Doc<"messageAttachments">,
): Promise<void> => {
  if (row.evidenceHold) return;
  for (const fileId of servedBlobsOf(row)) {
    if (!fileId || !(await ctx.db.system.get(fileId))) continue;
    if (await isPreservedBlob(ctx, fileId)) continue;
    await ctx.storage.delete(fileId);
  }
};

/** Delete every viewer's reveal of a photo (it is removed or purged: nothing left to reveal). */
export const deleteReveals = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
): Promise<void> => {
  const reveals = await ctx.db
    .query("messageImageReveals")
    .withIndex("by_attachment_viewer", (q) =>
      q.eq("attachmentId", attachmentId),
    )
    .collect();
  for (const reveal of reveals) await ctx.db.delete(reveal._id);
};

/**
 * Delete an attachment whose thread is gone (a deleted circle's purge kept it only for an open
 * report's evidence hold), with its blobs and reveals, once nothing holds it: nothing can reach it
 * any more. True when it was deleted. A held row, a live thread's row, and a quarantined photo
 * (csamEscalations.rowId points at it; the CSAM preservation owns it) are left alone.
 */
export const deleteIfOrphaned = async (
  ctx: MutationCtx,
  row: Doc<"messageAttachments">,
): Promise<boolean> => {
  if (row.evidenceHold) return false;
  if (row.kind === "image" && row.moderationStatus === "quarantined") {
    return false;
  }
  if ((await threadRowByAggregateId(ctx, row.threadAggregateId)) !== null) {
    return false;
  }
  await deleteAttachmentBlobs(ctx, row);
  if (row.kind === "image") await deleteReveals(ctx, row._id);
  await ctx.db.delete(row._id);
  return true;
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
  if (await deleteIfOrphaned(ctx, { ...row, evidenceHold: undefined })) return;
  await ctx.db.patch(attachmentId, {
    evidenceHold: undefined,
    updatedAt: Date.now(),
  });
  // A deleted member's attachment the report was holding: its account purge can finish now.
  await finishDeletedMemberPurge(ctx, { ...row, evidenceHold: undefined });
};

/**
 * Account deletion (conversation/purgeMemberMessagingData), for one attachment the member sent:
 * - a quarantined photo is left whole: the CSAM preservation owns it;
 * - an undelivered one (staged, still being checked, rejected) is deleted with its blobs, unless
 *   an open report holds it;
 * - a delivered one stays as a "removed" row (`removedReason: "account_deleted"`): a photo keeps
 *   its blurhash and size for the "Photo no longer available" placeholder, a location loses its
 *   coordinates and label (a rejected photo is also hidden, so it still reads "Removed by
 *   moderation" and its caption stays withheld). Its blobs are deleted, unless an open report
 *   holds them: then releaseEvidenceHold (or the evidence copy, reports/attachmentEvidence)
 *   finishes the purge.
 * A photo a moderator already removed keeps its reason. Idempotent.
 */
export const removeForDeletedMember = async (
  ctx: MutationCtx,
  row: Doc<"messageAttachments">,
): Promise<void> => {
  if (row.kind === "image" && row.moderationStatus === "quarantined") return;
  if (row.messageId === undefined) {
    if (row.evidenceHold) return;
    await deleteAttachmentBlobs(ctx, row);
    if (row.kind === "image") await deleteReveals(ctx, row._id);
    await ctx.db.delete(row._id);
    return;
  }
  const now = Date.now();
  let removed: Doc<"messageAttachments"> = row;
  if (row.kind === "image") {
    if (row.moderationStatus !== "removed") {
      // The "no longer available" placeholder keeps the blurhash only of a photo recipients could
      // already see; one still pending or stopped never shows a derivative of its image.
      const blurhash = isServable(row) ? row.blurhash : undefined;
      // A rejected photo stays hidden: "Removed by moderation" with its caption withheld
      // (isCaptionWithheld), exactly like a quarantined one, which is left whole above.
      const hidden =
        row.moderationStatus === "rejected" || row.hiddenFromSender;
      removed = {
        ...row,
        moderationStatus: "removed",
        removedReason: "account_deleted",
        blurhash,
        ...(hidden && { hiddenFromSender: true }),
      };
      await ctx.db.patch(row._id, {
        moderationStatus: "removed",
        removedReason: "account_deleted",
        blurhash,
        ...(hidden && { hiddenFromSender: true }),
        updatedAt: now,
      });
    }
  } else if (row.removedReason === undefined) {
    // A location a moderator removed too: its coordinates are the member's personal data.
    removed = {
      ...row,
      removedAt: row.removedAt ?? now,
      removedReason: "account_deleted",
    };
    await ctx.db.patch(row._id, {
      removedAt: row.removedAt ?? now,
      removedReason: "account_deleted",
      updatedAt: now,
    });
  }
  await finishDeletedMemberPurge(ctx, removed);
};

/**
 * The blob and personal-data part of removeForDeletedMember, once no open report holds the row:
 * delete its blobs and every viewer's reveal; a location's coordinates and label are cleared
 * (clearLocationCoordinates). A no-op for any other row.
 */
export const finishDeletedMemberPurge = async (
  ctx: MutationCtx,
  row: Doc<"messageAttachments">,
): Promise<void> => {
  if (row.removedReason !== "account_deleted" || row.evidenceHold) return;
  await deleteAttachmentBlobs(ctx, row);
  if (row.kind === "image") {
    await deleteReveals(ctx, row._id);
    return;
  }
  await clearLocationCoordinates(ctx, row._id);
};

/**
 * Clear a removed location's coordinates and label: nothing that places anyone stays on the row
 * (a moderator's removal once its evidence is settled, reports/attachmentEvidence; an account
 * deletion, finishDeletedMemberPurge). The read model and the render treat it as gone.
 */
export const clearLocationCoordinates = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
): Promise<void> => {
  await ctx.db.patch(attachmentId, {
    lat: undefined,
    lng: undefined,
    label: undefined,
    updatedAt: Date.now(),
  });
};

// Drop a photo that will never be delivered (expired, purged, or its pair is now blocked): blobs
// and row. An evidence-held row is kept. A quarantined row is kept whole too (the CSAM preservation
// owns it) but hidden from the sender's outbox exactly where a rejected one would disappear.
const discardAttachment = async (ctx: MutationCtx, row: Attachment) => {
  if (row.evidenceHold) return;
  if (row.moderationStatus === "quarantined") {
    await ctx.db.patch(row._id, {
      hiddenFromSender: true,
      updatedAt: Date.now(),
    });
    return;
  }
  await deleteAttachmentBlobs(ctx, row);
  await deleteReveals(ctx, row._id);
  await ctx.db.delete(row._id);
};

/**
 * The scheduled purge of a photo nobody will see (spec 2.8):
 * - "rejected" (at the verdict, REJECTED_ATTACHMENT_TTL_MS): a rejected or quarantined photo
 *   nobody asked a review for. An appealed one is left to the review (uphold deletes the blob).
 *   One that is a message (sent while it was still being checked) keeps its row, which the
 *   message references: a rejected one loses its blobs and reveals and is hidden from its sender
 *   exactly as a quarantined one is (both then read "removed" for everyone, so the two can't be
 *   told apart at this point either). One that is not a message is deleted (discardAttachment).
 * - "undelivered": scheduled at Send before photos were appended at send time; a no-op for any
 *   photo that is a message now (every sent one), kept for jobs scheduled before.
 * Never touches an evidence-held photo; a quarantined one is only hidden.
 */
export const purgeUndeliveredAttachment = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
  rule: "rejected" | "undelivered",
): Promise<void> => {
  const row = asImage(await ctx.db.get(attachmentId));
  if (!row) return;
  const stopped =
    row.moderationStatus === "rejected" ||
    row.moderationStatus === "quarantined";
  if (rule === "rejected") {
    if (!stopped || row.reviewRequestedAt !== undefined) return;
    if (row.messageId === undefined) {
      await discardAttachment(ctx, row);
      return;
    }
    if (row.evidenceHold) return;
    if (row.moderationStatus === "rejected") {
      await deleteAttachmentBlobs(ctx, row);
      await deleteReveals(ctx, row._id);
    }
    await ctx.db.patch(row._id, {
      hiddenFromSender: true,
      updatedAt: Date.now(),
    });
    return;
  }
  if (
    row.messageId !== undefined ||
    stopped ||
    row.moderationStatus === "removed"
  ) {
    return;
  }
  await discardAttachment(ctx, row);
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
      reason: "Our automated check flagged this photo, so it was removed.",
      automated: "true",
      redress: "Open the conversation and choose Ask for a review",
    },
  });
  await ctx.db.patch(row._id, { rejectionNotifiedAt: Date.now() });
};

/**
 * Settle the send batch `row` belongs to. Called on Send and after every state change of a photo
 * (verdicts, hash-check clears, an admin decision); a photo whose send was not requested yet is
 * left alone. It tells the sender of a stopped photo (once), then appends, in batch order, every
 * photo without a message that the check has not stopped (rejected / quarantined / removed are
 * passed over), whatever its check state: at Send that is the whole batch, in send order. Later
 * calls only append photos held before this rule existed (backfillHeldPhotos). The first appender
 * wins (`messageId`), which makes repeated calls no-ops. A caption rides on its photo: the caption
 * of a photo stopped before Send never reaches anyone. A blocked pair gets nothing: held photos
 * are dropped.
 */
export const settleSendBatch = async (
  ctx: MutationCtx,
  attachmentId: Id<"messageAttachments">,
): Promise<void> => {
  const anchor = asImage(await ctx.db.get(attachmentId));
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
    .filter(
      (row): row is Attachment =>
        row.kind === "image" && row.sendRequestedAt === anchor.sendRequestedAt,
    )
    .sort((a, b) => (a.sendIndex ?? 0) - (b.sendIndex ?? 0));

  const thread = await threadRowByAggregateId(ctx, anchor.threadAggregateId);
  // The pair-block rule is for exchange/DM threads only: a block between two circle members
  // removes neither from the circle's thread (spec 5.3), so their photos are delivered.
  const blocked =
    thread !== null &&
    thread.subjectKind !== "circle" &&
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
    if (STOPPED.has(row.moderationStatus)) continue;
    const messageId = await appendMessage(ctx, row, row.caption ?? "");
    if (messageId === null) return;
    await ctx.db.patch(row._id, { messageId, updatedAt: Date.now() });
  }
};

/**
 * Block side effect (social/blockMember): drop every photo either member SENT in a thread they
 * share that was not delivered yet, whatever its state (blobs and row; a quarantined one is only
 * hidden from its sender, an evidence-held one kept). So an unblock can't resurrect a delivery.
 */
export const dropUndeliveredPairAttachments = async (
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<void> => {
  const threads = await ctx.db
    .query("threads")
    .withIndex("by_participants_key", (q) =>
      q.eq(
        "participantsKey",
        participantsKeyOf([toMemberId(a as string), toMemberId(b as string)]),
      ),
    )
    .collect();
  for (const thread of threads) {
    for (const uploaderId of [a, b]) {
      const rows = await ctx.db
        .query("messageAttachments")
        .withIndex("by_thread_uploader", (q) =>
          q
            .eq("threadAggregateId", thread.aggregateId)
            .eq("uploaderId", uploaderId),
        )
        .collect();
      for (const row of rows) {
        if (row.messageId !== undefined) continue;
        if (row.kind === "location") {
          // Its map is still rendering: never appended (renderLocationMap re-checks the block).
          await deleteAttachmentBlobs(ctx, row);
          await ctx.db.delete(row._id);
        } else if (row.sendRequestedAt !== undefined) {
          await discardAttachment(ctx, row);
        }
      }
    }
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
  const row = asImage(await ctx.db.get(attachmentId));
  if (
    !row ||
    row.messageId !== undefined ||
    row.sendRequestedAt !== undefined ||
    row.moderationStatus === "rejected" ||
    row.moderationStatus === "quarantined"
  ) {
    return;
  }
  await discardAttachment(ctx, row);
};

/**
 * Per-request resolver from an image message's attachment id to the viewer's attachment view
 * (spec 2026-10-20 D2). Callers have already checked participation.
 *
 * A reader other than the uploader is served a URL ONLY for a servable photo (isServable), and
 * then per viewer: "blurred" (no URL) for the sensitive band, a sender who is not the viewer's
 * mutual follower (spec R.2), or a photo (or its message) the viewer has an open report on; the
 * viewer gets it by tapping Show (revealMessageImage), after which it is served to them directly
 * (`revealed`), except while they have an open report on it. A photo not servable yet (being
 * checked, "unscored" and waiting for a moderator, or a gate still closed) is "pending" with the
 * blurhash only once the photo passed the CSAM hash check and was re-encoded. A stopped photo
 * (rejected, quarantined, removed by a moderator, hidden, gone) is "removed" with no blurhash:
 * rejected and quarantined read exactly alike.
 *
 * The uploader sees their own photo: unblurred once servable; while pending, the image once its
 * hash check passed (as the outbox did), else the blurhash; once stopped, the refusal card
 * (`rejected`, rejectionFieldsOf: identical for a quarantined photo) until it is hidden from them.
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
    const row = asImage(await ctx.db.get(attachmentId));
    if (!row || row.hiddenFromSender) return { status: "removed" };
    const size = {
      ...(row.width !== undefined && { w: row.width }),
      ...(row.height !== undefined && { h: row.height }),
    };
    const own = row.uploaderId === viewer;
    if (row.moderationStatus === "removed") {
      // A deleted sender's photo keeps its placeholder ("no longer available"); a moderator's
      // removal shows nothing of the image.
      return row.removedReason === "account_deleted"
        ? {
            status: "removed",
            ...size,
            ...(row.blurhash !== undefined && { blurhash: row.blurhash }),
            unavailable: true as const,
          }
        : { status: "removed" };
    }
    if (
      row.moderationStatus === "rejected" ||
      row.moderationStatus === "quarantined"
    ) {
      return own
        ? { status: "rejected", ...size, ...rejectionFieldsOf(row) }
        : { status: "removed" };
    }
    if (!isServable(row)) {
      if (own) {
        const url =
          row.hashCheckedAt !== undefined
            ? await ctx.storage.getUrl(row.thumbFileId ?? row.fileId)
            : null;
        return {
          status: "pending",
          ...size,
          ...(url !== null
            ? { thumbUrl: url }
            : row.blurhash !== undefined && { blurhash: row.blurhash }),
        };
      }
      // Never a URL; the blurhash only from the hash-cleared re-encode.
      const blurhashShown =
        row.blurhash !== undefined &&
        row.hashCheckedAt !== undefined &&
        row.reencodedAt !== undefined;
      return {
        status: "pending",
        ...size,
        ...(blurhashShown && { blurhash: row.blurhash }),
      };
    }
    const placeholder = {
      ...size,
      ...(row.blurhash !== undefined && { blurhash: row.blurhash }),
    };
    let revealed = false;
    if (!own) {
      // Passed screening, blurred only because the sender isn't a mutual follower: labelled as such.
      const notMutual =
        row.moderationStatus === "approved" &&
        !(await isMutual(row.uploaderId));
      const blurredView: MessageAttachmentView = {
        status: "blurred",
        ...placeholder,
        ...(notMutual && { notMutual: true as const }),
      };
      if (await hasOpenReport(ctx, viewer, row)) return blurredView;
      if (row.moderationStatus !== "approved" || notMutual) {
        revealed = await hasRevealed(ctx, viewer, row._id);
        if (!revealed) return blurredView;
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

/**
 * What the sender's refusal card says of a photo the check stopped, in the outbox and in the
 * thread alike. A quarantined photo reads exactly like a photo the classifier flagged (reason
 * "flagged", the same review progress): nothing tells them apart.
 */
const rejectionFieldsOf = (
  row: Attachment,
): Pick<PendingAttachmentView, "reason" | "review"> => {
  // An admin upheld it, or (quarantined: never shown to an admin) its sender-view flip ran.
  const reviewDecided =
    row.moderationStatus === "rejected"
      ? row.reviewDecidedAt !== undefined
      : row.senderReviewUpheldAt !== undefined;
  return {
    reason:
      row.moderationStatus === "rejected" &&
      row.moderationLabel === "invalid_image"
        ? "unreadable"
        : "flagged",
    ...(row.reviewRequestedAt !== undefined && {
      review: reviewDecided ? ("upheld" as const) : ("requested" as const),
    }),
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

/** An open report by this viewer on the photo, or on the image message carrying it. */
export const hasOpenReport = async (
  ctx: QueryCtx,
  reporterId: Id<"users">,
  row: Doc<"messageAttachments">,
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
    return { ...base, status: "rejected", ...rejectionFieldsOf(row) };
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
