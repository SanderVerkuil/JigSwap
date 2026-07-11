import { query } from "../_generated/server";

// UNAUTHENTICATED feed for the /sitemap.xml server route: every approved definition's id +
// updatedAt (for <lastmod>). Catalog URLs ONLY — member profiles are deliberately not
// sitemap-listed (Phase 5 spec). A full collect() is fine at the current catalog scale; if the
// catalog ever grows past ~10k definitions, page this and stream the sitemap instead.
export const listSitemapEntries = query({
  args: {},
  handler: async (ctx): Promise<{ id: string; updatedAt: number }[]> => {
    const puzzles = await ctx.db
      .query("puzzles")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .collect();
    return puzzles.map((p) => ({ id: p._id, updatedAt: p.updatedAt }));
  },
});
