import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { query } from "../_generated/server";
import { clampUnpinnedPaginationOpts } from "../lib/pageSize";

// A page holds 1 to MAX_PAGE_SIZE entries whatever the client asks for. Convex counts the whole
// documents read, not the two fields returned: a full page reads 1000 complete puzzle rows
// (descriptions, tags, searchableText), a few MB at today's row sizes and well inside the 16 MiB
// and 32,000-document limits. Lower this if puzzle rows grow much larger.
const MAX_PAGE_SIZE = 1000;

// UNAUTHENTICATED feed for the /sitemap.xml server route: approved definitions' id + updatedAt
// (for <lastmod>), oldest first, one page per call. The route walks the cursor, so no single call
// reads the whole catalogue. Catalog URLs ONLY — member profiles are deliberately not
// sitemap-listed (Phase 5 spec).
export const listSitemapEntries = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<{ id: string; updatedAt: number }>> => {
    const puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .paginate(
        clampUnpinnedPaginationOpts(args.paginationOpts, MAX_PAGE_SIZE),
      );

    return {
      ...puzzles,
      page: puzzles.page.map((p) => ({ id: p._id, updatedAt: p.updatedAt })),
    };
  },
});
