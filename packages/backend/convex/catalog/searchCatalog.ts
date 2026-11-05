import type { PuzzleSummaryView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { clampPaginationOpts } from "../lib/pageSize";
import { toPuzzleSummaryView } from "./mappers";

// A page holds 1 to MAX_PAGE_SIZE puzzles whatever the client asks for.
const MAX_PAGE_SIZE = 50;

// Catalog read for the member add-copy picker: the approved catalogue, paginated, narrowed
// server-side by the search index when a term is given (so matches beyond the loaded page are
// found). Approved-only: at the search index for a term, at the by_status index for the plain
// browse.
export const searchCatalog = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchTerm: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PaginationResult<PuzzleSummaryView>> => {
    await requireMember(ctx);
    const term = args.searchTerm?.toLowerCase().trim() ?? "";
    const paginationOpts = clampPaginationOpts(
      args.paginationOpts,
      MAX_PAGE_SIZE,
    );

    const result =
      term.length > 0
        ? await ctx.db
            .query("puzzles")
            .withSearchIndex("by_searchable_text", (q) =>
              q.search("searchableText", term).eq("status", "approved"),
            )
            .paginate(paginationOpts)
        : await ctx.db
            .query("puzzles")
            .withIndex("by_status", (q) => q.eq("status", "approved"))
            .paginate(paginationOpts);

    const page = await Promise.all(
      result.page.map(async (puzzle) =>
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await boxArtImage(ctx, puzzle.image) : null,
        ),
      ),
    );

    return { ...result, page };
  },
});
