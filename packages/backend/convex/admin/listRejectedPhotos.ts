import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// The flagged-photos review queue: every auto-rejected copy photo, with enough context (image url,
// classifier verdict, uploader, puzzle title) for an admin to restore or confirm removal.
// Admin-only, gated exactly like getModerationStats.
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
        const title =
          copy?.snapshot?.title ??
          (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
        return {
          imageId: row._id,
          url: await ctx.storage.getUrl(row.fileId),
          score: row.moderationScore ?? null,
          label: row.moderationLabel ?? null,
          uploaderName: (await ctx.db.get(row.uploaderId))?.name ?? null,
          puzzleTitle: title ?? row._id,
          uploadedAt: row.createdAt,
        };
      }),
    );
  },
});
