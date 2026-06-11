import type { PuzzleSummaryView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toPuzzleSummaryView } from "./mappers";

// Catalog read: search-index suggestions for the add-copy picker. Approved-only (enforced at the
// search index), the empty-term short-circuit, and the default limit are preserved from legacy
// puzzles.getPuzzleSuggestions; rows map to summary DTOs (box-art URL resolved).
export const getPuzzleSuggestions = query({
  args: { searchTerm: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<PuzzleSummaryView[]> => {
    const limit = args.limit ?? 5;
    const searchTerm = args.searchTerm.toLowerCase().trim();
    if (searchTerm.length < 1) return [];

    const puzzles = await ctx.db
      .query("puzzles")
      .withSearchIndex("by_searchable_text", (q) =>
        q.search("searchableText", searchTerm).eq("status", "approved"),
      )
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
