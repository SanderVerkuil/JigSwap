import { query } from "../_generated/server";
import { requireAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { INVALID_IMAGE_LABEL } from "../lib/imageModeration/guards";
import {
  isHashCheckTimedOut,
  isHashCleared,
} from "../lib/imageModeration/hashCheckFields";

// The flagged-photos review queue: every auto-rejected copy photo, with enough context (image url,
// classifier verdict, uploader, puzzle title) for an admin to restore or confirm removal.
// Admin-only, gated exactly like getModerationStats. An upload the input guards refused
// (invalid_image) is left out: its blob is gone, so there is nothing to judge or restore.
//
// A photo an admin rejected after its CSAM hash check TIMED OUT (admin/decideUncheckedPhoto) is
// listed here too, with its image for the admin (as in Unchecked photos; the console blurs it
// until revealed) and `hashTimedOut`. Its hash gate stays closed, so restoring it does not publish
// it: it turns "approved" but unchecked again, and so returns to Unchecked photos as "Hash check
// timed out", where only "Approve without hash check" publishes it.
//
// It returns the oldest REJECTED_PHOTOS_QUEUE_LIMIT rejected photos. Every decision takes a photo
// out of "rejected" (restored, or deleted on confirm), so the next ones appear as the admin works
// through the queue.
// shortcut: only the result is bounded; the filter runs after the index, so the read also scans
// past every refused upload (invalid_image), and nothing deletes those unless RETENTION_ENFORCE
// names copyPhotos ("all" leaves it out); give them their own index if they pile up.
export const REJECTED_PHOTOS_QUEUE_LIMIT = 100;

export const listRejectedPhotos = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_moderation_status", (q) =>
        q.eq("moderationStatus", "rejected"),
      )
      .filter((q) => q.neq(q.field("moderationLabel"), INVALID_IMAGE_LABEL))
      .take(REJECTED_PHOTOS_QUEUE_LIMIT);

    return Promise.all(
      rows.map(async (row) => {
        // Puzzle title via the copy's cached snapshot, falling back to the puzzle row, then the
        // image id (same resolution as the pipeline's photo_auto_rejected stamp).
        const copy = await ctx.db.get(row.ownedPuzzleId);
        const uploader = await ctx.db.get(row.uploaderId);
        const title =
          copy?.snapshot?.title ??
          (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
        return {
          imageId: row._id,
          // No URL before the CSAM hash check has passed (hashCheckFields), except for the admin
          // once it timed out (the admin decided it, as in listUncheckedPhotos).
          url:
            isHashCleared(row) || isHashCheckTimedOut(row)
              ? await ctx.storage.getUrl(row.fileId)
              : null,
          hashTimedOut: isHashCheckTimedOut(row),
          score: row.moderationScore ?? null,
          label: row.moderationLabel ?? null,
          uploaderName: uploader ? adminMemberLabelOf(uploader) : null,
          puzzleTitle: title ?? row._id,
          uploadedAt: row.createdAt,
        };
      }),
    );
  },
});
