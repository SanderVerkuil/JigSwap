import type { PublicCatalogCardView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { clampUnpinnedPaginationOpts } from "../lib/pageSize";
import {
  publicAvailabilityFromByType,
  publicAvailabilityOf,
  ratingBreakdownFromTotals,
  ratingBreakdownOf,
} from "../library/definitionAggregates";
import { definitionTotalsOf } from "../library/definitionStats";

// The most definitions one page returns, whatever the client asks for (the web asks for 20).
export const PUBLIC_CATALOG_MAX_PAGE = 40;

// UNAUTHENTICATED paginated catalog list for the public /catalog page: approved definitions only
// (the standard leak gate), newest first, optionally narrowed by a search term (search index,
// status-filtered at the index), brand, and a piece-count range. Each page row is enriched with
// the card aggregates (rating summary + public availability count), read from the definition's
// definitionStats row (library/definitionStats): one document per card, however many reviews and
// copies the definition has. A page holds 1..PUBLIC_CATALOG_MAX_PAGE definitions; the page walks
// them by hand with `cursor`, so a client's endCursor (which would override that) is dropped.
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
    const paginationOpts = clampUnpinnedPaginationOpts(
      args.paginationOpts,
      PUBLIC_CATALOG_MAX_PAGE,
    );

    // brand/piece narrowing shared by both branches (status is handled per-branch: at the search
    // index for the search branch, at the by_status / by_status_brand index for the plain branch).
    const matchesFacets = (p: Doc<"puzzles">): boolean =>
      (args.brand === undefined || p.brand === args.brand) &&
      (args.pieceMin === undefined || p.pieceCount >= args.pieceMin) &&
      (args.pieceMax === undefined || p.pieceCount <= args.pieceMax);

    // Plain browse: only approved rows are read (one brand's when filtered), newest first by the
    // indexes' implicit _creationTime suffix. The piece range stays a filter so that order holds.
    const brand = args.brand;
    const approved =
      brand === undefined
        ? ctx.db
            .query("puzzles")
            .withIndex("by_status", (q) => q.eq("status", "approved"))
        : ctx.db
            .query("puzzles")
            .withIndex("by_status_brand", (q) =>
              q.eq("status", "approved").eq("brand", brand),
            );

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
            .paginate(paginationOpts)
        : await approved
            .order("desc") // newest first by _creationTime
            .filter((q) =>
              q.and(
                args.pieceMin === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.gte(q.field("pieceCount"), args.pieceMin),
                args.pieceMax === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.lte(q.field("pieceCount"), args.pieceMax),
              ),
            )
            .paginate(paginationOpts);

    // Belt-and-braces: the branches above already gate status/facets, but the enrichment below is
    // the last line of defence against a future filter regression leaking a pending row.
    const rows = result.page.filter(
      (p) => p.status === "approved" && matchesFacets(p),
    );

    // Until a definition's first recompute the card computes its two aggregates live, as before;
    // a shared owner-visibility cache resolves each distinct owner across the page once.
    const visibilityCache = new Map<string, "public" | "private">();
    const cardAggregatesOf = async (puzzleId: Id<"puzzles">) => {
      const totals = await definitionTotalsOf(ctx, puzzleId);
      if (totals) {
        return {
          rating: ratingBreakdownFromTotals(totals),
          availability: publicAvailabilityFromByType(totals.publicAvailable),
        };
      }
      const owned = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
        .collect();
      return {
        rating: await ratingBreakdownOf(ctx, puzzleId),
        availability: await publicAvailabilityOf(ctx, owned, visibilityCache),
      };
    };
    const page: PublicCatalogCardView[] = await Promise.all(
      rows.map(async (puzzle) => {
        const { rating, availability } = await cardAggregatesOf(puzzle._id);
        const image = await boxArtImage(ctx, puzzle.image);
        return {
          _id: puzzle._id,
          title: puzzle.title,
          brand: puzzle.brand,
          pieceCount: puzzle.pieceCount,
          difficulty: puzzle.difficulty,
          image: image?.url ?? null,
          ...(image?.srcSet !== undefined && { imageSrcSet: image.srcSet }),
          rating: { value: rating.rating, count: rating.count },
          availableToSwap: availability.total,
        };
      }),
    );

    return { ...result, page };
  },
});
