import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import {
  isHashCheckTimedOut,
  isHashCleared,
} from "../lib/imageModeration/hashCheckFields";

// The flagged-photos review queue: every auto-rejected copy photo, with enough context (image url,
// classifier verdict, uploader, puzzle title) for an admin to restore or confirm removal.
// Admin-only, gated exactly like getModerationStats.
//
// A photo an admin rejected after its CSAM hash check TIMED OUT (admin/decideUncheckedPhoto) is
// listed here too, with its image for the admin (as in Unchecked photos; the console blurs it
// until revealed) and `hashTimedOut`. Its hash gate stays closed, so restoring it does not publish
// it: it turns "approved" but unchecked again, and so returns to Unchecked photos as "Hash check
// timed out", where only "Approve without hash check" publishes it.
export const listRejectedPhotos = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const rows = await ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_moderation_status", (q) =>
        q.eq("moderationStatus", "rejected"),
      )
      .collect();

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
