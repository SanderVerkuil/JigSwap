import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { MESSAGE_PHOTO_LABEL } from "../conversation/messageAttachments";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { boxArtTitle } from "../lib/imageModeration/boxArtReferences";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";

// Per status and table: the queue shows at most this many rows (oldest first); the rest follow as
// earlier ones are decided.
export const UNCHECKED_QUEUE_LIMIT = 50;

type Status = "pending" | "unscored";

const uploaderLabel = async (
  ctx: QueryCtx,
  uploaderId: Doc<"users">["_id"],
) => {
  const uploader = await ctx.db.get(uploaderId);
  return uploader ? adminMemberLabelOf(uploader) : null;
};

// The admin queue of photos the classifier has not decided: "unscored" (it could not check them)
// and "pending" (still being checked or waiting for a retry), for copy photos, completion photos
// and box art (boxArtUploads; served to no one until approved, lib/imageModeration/boxArtUrl).
// Admin-only, gated like listRejectedPhotos. The admin sees the real image (behind the console's
// blur guard) to decide it by hand via decideUncheckedPhoto; an unscored photo of any table can
// also be sent through the pipeline again (admin/recheckPhoto, `canRecheck`).
//
// Message photos (source "message", spec 2026-10-20 D5): only "unscored" ones that were SENT (are
// a message, so a recipient is waiting on "Pending review"). Pending ones are in flight for
// seconds and stay private; the stalled sweep turns a stuck one unscored. Nothing about the
// conversation or the recipient is listed, only the uploader. URL only once hash-cleared AND
// re-encoded (the served blob is the metadata-free one; one never re-encoded needs "Check again").
export const listUncheckedPhotos = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const statuses: Status[] = ["unscored", "pending"];
    const items = [];
    for (const status of statuses) {
      const copyRows = await ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", status),
        )
        .take(UNCHECKED_QUEUE_LIMIT);
      for (const row of copyRows) {
        const copy = await ctx.db.get(row.ownedPuzzleId);
        const title =
          copy?.snapshot?.title ??
          (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
        items.push({
          key: `copy:${row._id}`,
          source: "copy" as const,
          imageId: row._id as string,
          status,
          reason: row.moderationReason ?? null,
          attempts: row.moderationAttempts ?? null,
          // No URL before the CSAM hash check has passed (hashCheckFields).
          url: isHashCleared(row) ? await ctx.storage.getUrl(row.fileId) : null,
          puzzleTitle: title ?? (row._id as string),
          uploaderName: await uploaderLabel(ctx, row.uploaderId),
          uploadedAt: row.createdAt,
          canRecheck: status === "unscored",
        });
      }
      const completionRows = await ctx.db
        .query("completionImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", status),
        )
        .take(UNCHECKED_QUEUE_LIMIT);
      for (const row of completionRows) {
        const completion = await ctx.db
          .query("completions")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", row.completionId),
          )
          .unique();
        items.push({
          key: `completion:${row._id}`,
          source: "completion" as const,
          imageId: row._id as string,
          status,
          reason: row.moderationReason ?? null,
          attempts: row.moderationAttempts ?? null,
          // No URL before the CSAM hash check has passed (hashCheckFields).
          url: isHashCleared(row) ? await ctx.storage.getUrl(row.fileId) : null,
          puzzleTitle: completion?.copySnapshot?.title ?? row.completionId,
          uploaderName: await uploaderLabel(ctx, row.uploaderId),
          uploadedAt: row.createdAt,
          canRecheck: status === "unscored",
        });
      }
      const boxArtRows = await ctx.db
        .query("boxArtUploads")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", status),
        )
        .take(UNCHECKED_QUEUE_LIMIT);
      for (const row of boxArtRows) {
        items.push({
          key: `boxArt:${row._id}`,
          source: "boxArt" as const,
          imageId: row._id as string,
          status,
          reason: row.moderationReason ?? null,
          attempts: row.moderationAttempts ?? null,
          // No URL before the CSAM hash check has passed (hashCheckFields).
          url: isHashCleared(row)
            ? await ctx.storage.getUrl(row.storageId)
            : null,
          puzzleTitle:
            (await boxArtTitle(ctx, row.storageId)) ?? (row._id as string),
          uploaderName: await uploaderLabel(ctx, row.uploaderId),
          uploadedAt: row.createdAt,
          canRecheck: status === "unscored",
        });
      }
    }
    const messageRows = await ctx.db
      .query("messageAttachments")
      .withIndex("by_moderation_status", (q) =>
        q.eq("moderationStatus", "unscored"),
      )
      .filter((q) => q.neq(q.field("messageId"), undefined))
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
    return items.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});
