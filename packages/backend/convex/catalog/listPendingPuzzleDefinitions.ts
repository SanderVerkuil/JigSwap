import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side for the moderation queue: the pending submissions awaiting approve/reject. Admin-only
// (requireMember gates access); reads resolve the box-art URL so the queue can render thumbnails.
export const listPendingPuzzleDefinitions = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);

    const pending = await ctx.db
      .query("puzzles")
      .filter((q) => q.eq(q.field("status"), "pending"))
      .order("desc")
      .collect();

    return Promise.all(
      pending.map(async (puzzle) => ({
        ...puzzle,
        image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : undefined,
      })),
    );
  },
});
