import type { PuzzleSummaryView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { toPuzzleSummaryView } from "./mappers";

// Catalog read for the member add-copy picker: the approved catalogue, paginated, narrowed
// server-side by the search index when a term is given (so matches beyond the loaded page are
// found). Approved-only: at the search index for a term, as a filter for the plain browse.
export const searchCatalog = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchTerm: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PaginationResult<PuzzleSummaryView>> => {
    await requireMember(ctx);
    const term = args.searchTerm?.toLowerCase().trim() ?? "";

    const result =
      term.length > 0
        ? await ctx.db
            .query("puzzles")
            .withSearchIndex("by_searchable_text", (q) =>
              q.search("searchableText", term).eq("status", "approved"),
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("puzzles")
            .filter((q) => q.eq(q.field("status"), "approved"))
            .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (puzzle) =>
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await boxArtUrl(ctx, puzzle.image) : null,
        ),
      ),
    );

    return { ...result, page };
  },
});
