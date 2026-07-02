import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Catalog read: the puzzle-definition ids the acting member has favorited. The batch variant of
// isFavorite — one subscription drives every heart on a card grid (the client checks membership)
// instead of a per-card query. Auth-gated to the acting member.
export const myFavoritePuzzleIds = query({
  args: {},
  handler: async (ctx): Promise<Id<"puzzles">[]> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const rows = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", memberId))
      .collect();

    return rows.map((row) => row.puzzleId);
  },
});
