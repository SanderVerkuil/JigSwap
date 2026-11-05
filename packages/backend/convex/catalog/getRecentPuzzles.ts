import type { PuzzleSummaryView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { clampLimit } from "../lib/pageSize";
import { toPuzzleSummaryView } from "./mappers";

const DEFAULT_LIMIT = 8;
// An anonymous read: 1 to MAX_LIMIT puzzles whatever the client asks for.
const MAX_LIMIT = 24;

// Catalog read: the most-recent approved puzzles for the home rail. Approved-only + newest-first +
// the default limit are preserved from legacy puzzles.getRecentPuzzles; rows map to summary DTOs.
export const getRecentPuzzles = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<PuzzleSummaryView[]> => {
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_LIMIT,
      max: MAX_LIMIT,
    });
    const puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(limit);

    return Promise.all(
      puzzles.map(async (puzzle) =>
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await boxArtImage(ctx, puzzle.image) : null,
        ),
      ),
    );
  },
});
