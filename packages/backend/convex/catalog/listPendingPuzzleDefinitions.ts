import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";

// Read side for the moderation queue: the pending submissions awaiting approve/reject. Admin-only
// (requireMember gates access); reads resolve the box-art URL so the queue can render thumbnails.
export const listPendingPuzzleDefinitions = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const pending = await ctx.db
      .query("puzzles")
      .filter((q) => q.eq(q.field("status"), "pending"))
      .order("desc")
      .collect();

    return Promise.all(
      pending.map(async (puzzle) => ({
        ...puzzle,
        image: puzzle.image ? await boxArtUrl(ctx, puzzle.image) : undefined,
      })),
    );
  },
});
