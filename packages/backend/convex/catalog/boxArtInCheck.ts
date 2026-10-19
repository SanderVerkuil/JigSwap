import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { isBoxArtServable } from "../lib/imageModeration/boxArtUrl";

// Box art the acting member uploaded that is still being checked: the pipeline has not approved
// it yet ("pending", or "unscored" while it waits for a retry or an admin), or its hash check has
// not passed. Until then no read path serves it (lib/imageModeration/boxArtUrl), so the puzzle
// shows its placeholder; these reads let the web app tell the UPLOADER why, and nobody else.
// Rejected and quarantined box art is detached from everything and never reported here.

// Per status: plenty for one member's uploads in flight.
const LIMIT = 50;

const isInCheck = (row: Doc<"boxArtUploads">): boolean =>
  (row.moderationStatus === "pending" ||
    row.moderationStatus === "unscored" ||
    row.moderationStatus === "approved") &&
  !isBoxArtServable(row);

/** Whether `image` is box art the acting member uploaded that is still being checked. */
export const isMyBoxArtInCheck = query({
  args: { image: v.string() },
  handler: async (ctx, { image }): Promise<boolean> => {
    const member = await optionalActingMember(ctx);
    const storageId = ctx.db.system.normalizeId("_storage", image);
    if (!member || !storageId) return false;
    const row = await ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    return !!row && row.uploaderId === member && isInCheck(row);
  },
});

/**
 * The definitions (puzzles ids) whose box art is the acting member's own upload still being
 * checked. Empty for an anonymous caller.
 */
export const listMyBoxArtInCheck = query({
  args: {},
  handler: async (ctx): Promise<Id<"puzzles">[]> => {
    const member = await optionalActingMember(ctx);
    if (!member) return [];
    const rows: Doc<"boxArtUploads">[] = [];
    for (const status of ["pending", "unscored"] as const) {
      rows.push(
        ...(await ctx.db
          .query("boxArtUploads")
          .withIndex("by_uploader_status", (q) =>
            q.eq("uploaderId", member).eq("moderationStatus", status),
          )
          .take(LIMIT)),
      );
    }
    // Approved but its hash check has not passed (the hash service was unreachable).
    const waitingOnHash = await ctx.db
      .query("boxArtUploads")
      .withIndex("by_hash_check_pending", (q) =>
        q.gt("hashCheckPendingSince", 0),
      )
      .take(LIMIT);
    rows.push(
      ...waitingOnHash.filter(
        (row) =>
          row.uploaderId === member && row.moderationStatus === "approved",
      ),
    );

    const puzzleIds = new Set<Id<"puzzles">>();
    for (const row of rows) {
      if (!isInCheck(row)) continue;
      const holders = await ctx.db
        .query("puzzles")
        .withIndex("by_image", (q) => q.eq("image", row.storageId))
        .collect();
      for (const puzzle of holders) puzzleIds.add(puzzle._id);
    }
    return [...puzzleIds];
  },
});
