import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { query } from "../_generated/server";
import { clampPaginationOpts } from "../lib/pageSize";

// A page holds 1 to MAX_PAGE_SIZE entries whatever the client asks for. An entry is two small
// fields, so a full page stays far inside one function's read limit however large the catalogue.
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
      .paginate(clampPaginationOpts(args.paginationOpts, MAX_PAGE_SIZE));

    return {
      ...puzzles,
      page: puzzles.page.map((p) => ({ id: p._id, updatedAt: p.updatedAt })),
    };
  },
});
