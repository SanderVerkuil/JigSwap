import type { PuzzleSummaryView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toPuzzleSummaryView } from "./mappers";

// Catalog read: the most-recent approved puzzles for the home rail. Approved-only + newest-first +
// the default limit are preserved from legacy puzzles.getRecentPuzzles; rows map to summary DTOs.
export const getRecentPuzzles = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<PuzzleSummaryView[]> => {
    const limit = args.limit ?? 8;
    const puzzles = await ctx.db
      .query("puzzles")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .take(limit);

    return Promise.all(
      puzzles.map(async (puzzle) =>
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null,
        ),
      ),
    );
  },
});
