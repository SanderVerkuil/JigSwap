import { query } from "../_generated/server";
import { requireAdmin } from "../identity/isAdmin";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { PENDING_QUEUE_LIMIT } from "./pendingQueue";

// Read side for the moderation queue: the newest pending submissions awaiting approve/reject. Admin-only
// (requireMember gates access); reads resolve the box-art URL so the queue can render thumbnails.
export const listPendingPuzzleDefinitions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const pending = await ctx.db
      .query("puzzles")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(PENDING_QUEUE_LIMIT);

    return Promise.all(
      pending.map(async (puzzle) => ({
        ...puzzle,
        image: puzzle.image ? await boxArtUrl(ctx, puzzle.image) : undefined,
      })),
    );
  },
});
