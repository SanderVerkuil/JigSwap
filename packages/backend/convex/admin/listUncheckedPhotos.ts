import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
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
// blur guard) to decide it by hand via decideUncheckedPhoto; unscored box art can also be sent
// through the pipeline again (admin/recheckBoxArt, `canRecheck`).
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
          canRecheck: false,
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
          canRecheck: false,
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
    return items.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});
