import type {
  Expression,
  FilterBuilder,
  GenericTableInfo,
} from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import {
  asImage,
  MESSAGE_PHOTO_LABEL,
} from "../conversation/messageAttachments";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { boxArtTitle } from "../lib/imageModeration/boxArtReferences";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import { CIRCLE_ICON_LABEL } from "../sharing/circleIconModerationStore";

// Per status and table: the queue shows at most this many rows (oldest first); the rest follow as
// earlier ones are decided.
export const UNCHECKED_QUEUE_LIMIT = 50;

type Status = "pending" | "unscored" | "hashTimedOut";

const uploaderLabel = async (
  ctx: QueryCtx,
  uploaderId: Doc<"users">["_id"],
) => {
  const uploader = await ctx.db.get(uploaderId);
  return uploader ? adminMemberLabelOf(uploader) : null;
};

// Query filters over the hash-check fields every photo table shares (hashCheckFields). They run
// BEFORE `.take`, so rows the queue skips never use up its UNCHECKED_QUEUE_LIMIT.
const hashField = <T extends GenericTableInfo>(
  q: FilterBuilder<T>,
  name: "hashCheckedAt" | "hashCheckTimedOutAt" | "moderationStatus",
) =>
  q.field(name as unknown as T["fieldPaths"]) as unknown as Expression<
    string | number | undefined
  >;

// Not a timed-out hash check that is still closed (the negation of isHashCheckTimedOut).
const notTimedOut = <T extends GenericTableInfo>(q: FilterBuilder<T>) =>
  q.or(
    q.eq(hashField(q, "hashCheckTimedOutAt"), undefined),
    q.neq(hashField(q, "hashCheckedAt"), undefined),
  );

// On a by_hash_check_timed_out row (timed out, gate closed): the admin can still decide it, i.e.
// it is not already rejected, quarantined or removed.
const awaitsTimeoutDecision = <T extends GenericTableInfo>(
  q: FilterBuilder<T>,
) =>
  q.and(
    q.neq(hashField(q, "moderationStatus"), "rejected"),
    q.neq(hashField(q, "moderationStatus"), "quarantined"),
    q.neq(hashField(q, "moderationStatus"), "removed"),
  );

// The image an admin sees: once the hash check has passed, or once it timed out (an admin decides
// it then). Never before, to anyone.
const adminUrl = (
  ctx: QueryCtx,
  row: { hashCheckedAt?: number; hashCheckPendingSince?: number },
  status: Status,
  fileId: Id<"_storage">,
) =>
  status === "hashTimedOut" || isHashCleared(row)
    ? ctx.storage.getUrl(fileId)
    : null;

const copyItem = async (
  ctx: QueryCtx,
  row: Doc<"ownedPuzzleImages">,
  status: Status,
) => {
  const copy = await ctx.db.get(row.ownedPuzzleId);
  const title =
    copy?.snapshot?.title ??
    (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
  return {
    key: `copy:${row._id}`,
    source: "copy" as const,
    imageId: row._id as string,
    status,
    reason: row.moderationReason ?? null,
    attempts: row.moderationAttempts ?? null,
    url: await adminUrl(ctx, row, status, row.fileId),
    puzzleTitle: title ?? (row._id as string),
    uploaderName: await uploaderLabel(ctx, row.uploaderId),
    uploadedAt: row.createdAt,
    canRecheck: status === "unscored",
  };
};

const completionItem = async (
  ctx: QueryCtx,
  row: Doc<"completionImages">,
  status: Status,
) => {
  const completion = await ctx.db
    .query("completions")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.completionId))
    .unique();
  return {
    key: `completion:${row._id}`,
    source: "completion" as const,
    imageId: row._id as string,
    status,
    reason: row.moderationReason ?? null,
    attempts: row.moderationAttempts ?? null,
    url: await adminUrl(ctx, row, status, row.fileId),
    puzzleTitle: completion?.copySnapshot?.title ?? row.completionId,
    uploaderName: await uploaderLabel(ctx, row.uploaderId),
    uploadedAt: row.createdAt,
    canRecheck: status === "unscored",
  };
};

const boxArtItem = async (
  ctx: QueryCtx,
  row: Doc<"boxArtUploads">,
  status: Status,
) => ({
  key: `boxArt:${row._id}`,
  source: "boxArt" as const,
  imageId: row._id as string,
  status,
  reason: row.moderationReason ?? null,
  attempts: row.moderationAttempts ?? null,
  url: await adminUrl(ctx, row, status, row.storageId),
  puzzleTitle: (await boxArtTitle(ctx, row.storageId)) ?? (row._id as string),
  uploaderName: await uploaderLabel(ctx, row.uploaderId),
  uploadedAt: row.createdAt,
  canRecheck: status === "unscored",
});

// A circle icon: only which kind of photo and who uploaded it, never the circle's name or members.
const circleIconItem = async (
  ctx: QueryCtx,
  row: Doc<"circleIcons">,
  status: Status,
) => ({
  key: `circleIcon:${row._id}`,
  source: "circleIcon" as const,
  imageId: row._id as string,
  status,
  reason: row.moderationReason ?? null,
  attempts: row.moderationAttempts ?? null,
  url: await adminUrl(ctx, row, status, row.fileId),
  puzzleTitle: CIRCLE_ICON_LABEL,
  uploaderName: await uploaderLabel(ctx, row.uploaderId),
  uploadedAt: row.createdAt,
  canRecheck: status === "unscored",
});

// The admin queue of photos the classifier has not decided: "unscored" (it could not check them)
// and "pending" (still being checked or waiting for a retry), for copy photos, completion photos,
// box art (boxArtUploads; served to no one until approved, lib/imageModeration/boxArtUrl) and
// circle icons (circleIcons; likewise, sharing/circleIcons).
// Admin-only, gated like listRejectedPhotos. The admin sees the real image (behind the console's
// blur guard) to decide it by hand via decideUncheckedPhoto; an unscored photo of any table can
// also be sent through the pipeline again (admin/recheckPhoto, `canRecheck`).
//
// Message photos (source "message", spec 2026-10-20 D5): only "unscored" ones that were SENT (are
// a message, so a recipient is waiting on "Pending review"). Pending ones are in flight for
// seconds and stay private; the stalled sweep turns a stuck one unscored. Nothing about the
// conversation or the recipient is listed, only the uploader. URL only once hash-cleared AND
// re-encoded (the served blob is the metadata-free one; one never re-encoded needs "Check again").
//
// "hashTimedOut": a photo of any table (a sent message photo included) whose CSAM hash check could
// not be done within HASH_CHECK_TIMEOUT_MS (lib/imageModeration/hashRecheckPool), whatever the
// classifier said. Listed once, as hashTimedOut, with its image for the admin who now decides it.
export const listUncheckedPhotos = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const statuses = ["unscored", "pending"] as const;
    const items = [];
    for (const status of statuses) {
      const copyRows = await ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", status),
        )
        .filter(notTimedOut)
        .take(UNCHECKED_QUEUE_LIMIT);
      for (const row of copyRows) {
        items.push(await copyItem(ctx, row, status));
      }
      const completionRows = await ctx.db
        .query("completionImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", status),
        )
        .filter(notTimedOut)
        .take(UNCHECKED_QUEUE_LIMIT);
      for (const row of completionRows) {
        items.push(await completionItem(ctx, row, status));
      }
      const boxArtRows = await ctx.db
        .query("boxArtUploads")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", status),
        )
        .filter(notTimedOut)
        .take(UNCHECKED_QUEUE_LIMIT);
      for (const row of boxArtRows) {
        items.push(await boxArtItem(ctx, row, status));
      }
      const circleIconRows = await ctx.db
        .query("circleIcons")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", status),
        )
        .filter(notTimedOut)
        .take(UNCHECKED_QUEUE_LIMIT);
      for (const row of circleIconRows) {
        items.push(await circleIconItem(ctx, row, status));
      }
    }
    const messageRows = await ctx.db
      .query("messageAttachments")
      .withIndex("by_moderation_status", (q) =>
        q.eq("moderationStatus", "unscored"),
      )
      .filter((q) =>
        q.and(q.neq(q.field("messageId"), undefined), notTimedOut(q)),
      )
      .take(UNCHECKED_QUEUE_LIMIT);
    for (const row of messageRows) {
      if (row.kind !== "image") continue;
      items.push({
        key: `message:${row._id}`,
        source: "message" as const,
        imageId: row._id as string,
        status: "unscored" as const,
        reason: row.moderationReason ?? null,
        attempts: row.moderationAttempts ?? null,
        url:
          row.hashCheckedAt !== undefined && row.reencodedAt !== undefined
            ? await ctx.storage.getUrl(row.fileId)
            : null,
        puzzleTitle: MESSAGE_PHOTO_LABEL,
        uploaderName: await uploaderLabel(ctx, row.uploaderId),
        uploadedAt: row.createdAt,
        canRecheck: true,
      });
    }

    // Timed-out hash checks: the by_hash_check_timed_out range holds exactly the timed-out rows
    // whose hash gate is still closed; the ones an admin can still decide are filtered BEFORE the
    // take, so rejected (or quarantined) timed-out rows never crowd them out of the queue.
    const timedOut = "hashTimedOut" as const;
    const copyWaiting = await ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_hash_check_timed_out", (q) =>
        q.eq("hashCheckedAt", undefined).gt("hashCheckTimedOutAt", 0),
      )
      .filter(awaitsTimeoutDecision)
      .take(UNCHECKED_QUEUE_LIMIT);
    for (const row of copyWaiting) {
      items.push(await copyItem(ctx, row, timedOut));
    }
    const completionWaiting = await ctx.db
      .query("completionImages")
      .withIndex("by_hash_check_timed_out", (q) =>
        q.eq("hashCheckedAt", undefined).gt("hashCheckTimedOutAt", 0),
      )
      .filter(awaitsTimeoutDecision)
      .take(UNCHECKED_QUEUE_LIMIT);
    for (const row of completionWaiting) {
      items.push(await completionItem(ctx, row, timedOut));
    }
    const boxArtWaiting = await ctx.db
      .query("boxArtUploads")
      .withIndex("by_hash_check_timed_out", (q) =>
        q.eq("hashCheckedAt", undefined).gt("hashCheckTimedOutAt", 0),
      )
      .filter(awaitsTimeoutDecision)
      .take(UNCHECKED_QUEUE_LIMIT);
    for (const row of boxArtWaiting) {
      items.push(await boxArtItem(ctx, row, timedOut));
    }
    const circleIconWaiting = await ctx.db
      .query("circleIcons")
      .withIndex("by_hash_check_timed_out", (q) =>
        q.eq("hashCheckedAt", undefined).gt("hashCheckTimedOutAt", 0),
      )
      .filter(awaitsTimeoutDecision)
      .take(UNCHECKED_QUEUE_LIMIT);
    for (const row of circleIconWaiting) {
      items.push(await circleIconItem(ctx, row, timedOut));
    }
    // Message photos: only sent ones (a staged photo expires within a day).
    const messageWaiting = await ctx.db
      .query("messageAttachments")
      .withIndex("by_hash_check_timed_out", (q) =>
        q.eq("hashCheckedAt", undefined).gt("hashCheckTimedOutAt", 0),
      )
      .filter((q) =>
        q.and(q.neq(q.field("messageId"), undefined), awaitsTimeoutDecision(q)),
      )
      .take(UNCHECKED_QUEUE_LIMIT);
    for (const attachment of messageWaiting) {
      const row = asImage(attachment);
      if (!row) continue;
      items.push({
        key: `message:${row._id}`,
        source: "message" as const,
        imageId: row._id as string,
        status: timedOut,
        reason: row.moderationReason ?? null,
        attempts: row.moderationAttempts ?? null,
        // The admin decides it now; the served blob must still be the re-encode.
        url:
          row.reencodedAt !== undefined
            ? await ctx.storage.getUrl(row.fileId)
            : null,
        puzzleTitle: MESSAGE_PHOTO_LABEL,
        uploaderName: await uploaderLabel(ctx, row.uploaderId),
        uploadedAt: row.createdAt,
        canRecheck: false,
      });
    }
    return items.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});
