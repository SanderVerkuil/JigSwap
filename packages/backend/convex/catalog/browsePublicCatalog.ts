import type { PublicCatalogCardView } from "@jigswap/contracts";
import { type PaginationResult, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import {
  publicAvailabilityOf,
  ratingBreakdownOf,
} from "../library/definitionAggregates";

// UNAUTHENTICATED paginated catalog list for the public /catalog page: approved definitions only
// (the standard leak gate), newest first, optionally narrowed by a search term (search index,
// status-filtered at the index), brand, and a piece-count range. Each page row is enriched with
// the card aggregates (rating summary + public availability count).
//
// Sort is newest-first ONLY: sorting by rating would require a denormalized per-definition rating
// (a computed aggregate can't order a paginated index scan) — deliberately deferred.
export const browsePublicCatalog = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchTerm: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceMin: v.optional(v.number()),
    pieceMax: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<PublicCatalogCardView>> => {
    const term = args.searchTerm?.toLowerCase().trim() ?? "";

    // brand/piece narrowing shared by both branches (status is handled per-branch: at the search
    // index for the search branch, as a filter for the plain branch).
    const matchesFacets = (p: Doc<"puzzles">): boolean =>
      (args.brand === undefined || p.brand === args.brand) &&
      (args.pieceMin === undefined || p.pieceCount >= args.pieceMin) &&
      (args.pieceMax === undefined || p.pieceCount <= args.pieceMax);

    const result =
      term.length > 0
        ? await ctx.db
            .query("puzzles")
            .withSearchIndex("by_searchable_text", (q) =>
              q.search("searchableText", term).eq("status", "approved"),
            )
            .filter((q) =>
              q.and(
                args.brand === undefined
                  ? q.eq(q.field("status"), "approved") // no-op placeholder keeps the AND non-empty
                  : q.eq(q.field("brand"), args.brand),
                args.pieceMin === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.gte(q.field("pieceCount"), args.pieceMin),
                args.pieceMax === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.lte(q.field("pieceCount"), args.pieceMax),
              ),
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("puzzles")
            .order("desc") // newest first by _creationTime
            .filter((q) =>
              q.and(
                q.eq(q.field("status"), "approved"),
                args.brand === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.eq(q.field("brand"), args.brand),
                args.pieceMin === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.gte(q.field("pieceCount"), args.pieceMin),
                args.pieceMax === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.lte(q.field("pieceCount"), args.pieceMax),
              ),
            )
            .paginate(args.paginationOpts);

    // Belt-and-braces: the branches above already gate status/facets, but the enrichment below is
    // the last line of defence against a future filter regression leaking a pending row.
    const rows = result.page.filter(
      (p) => p.status === "approved" && matchesFacets(p),
    );

    // Shared owner-visibility cache so each distinct owner across the page resolves once.
    const visibilityCache = new Map<string, "public" | "private">();
    const page: PublicCatalogCardView[] = await Promise.all(
      rows.map(async (puzzle) => {
        const rating = await ratingBreakdownOf(ctx, puzzle._id);
        const owned = await ctx.db
          .query("ownedPuzzles")
          .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzle._id))
          .collect();
        const availability = await publicAvailabilityOf(
          ctx,
          owned,
          visibilityCache,
        );
        return {
          _id: puzzle._id,
          title: puzzle.title,
          brand: puzzle.brand,
          pieceCount: puzzle.pieceCount,
          difficulty: puzzle.difficulty,
          image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null,
          rating: { value: rating.rating, count: rating.count },
          availableToSwap: availability.total,
        };
      }),
    );

    return { ...result, page };
  },
});
