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
// The most rows one call reads of a brand to apply a piece range to them (this read is anonymous).
// A page cut short by this comes back short, even empty, with the cursor where it stopped.
export const PUBLIC_CATALOG_FILTER_READS = 500;

// UNAUTHENTICATED paginated catalog list for the public /catalog page: approved definitions only
// (the standard leak gate), newest first, optionally narrowed by a search term (search index,
// status-filtered at the index), brand, and a piece-count range. Each page row is enriched with
// the card aggregates (rating summary + public availability count), read from the definition's
// definitionStats row (library/definitionStats): one document per card, however many reviews and
// copies the definition has. A page holds 1..PUBLIC_CATALOG_MAX_PAGE definitions; the page walks
// them by hand with `cursor`, so a client's endCursor (which would override that) is dropped.
//
// Sort is newest-first, except that a piece range without a brand reads by_status_pieces: largest
// first and newest first within one count, so a bucket of mostly 1,000-piece puzzles still reads as
// newest first, and a range nothing is in costs nothing. Sorting by rating would require a
// denormalized per-definition rating (a computed aggregate can't order a paginated index scan) —
// deliberately deferred.

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

    const { brand, pieceMin, pieceMax } = args;
    if (
      pieceMin !== undefined &&
      pieceMax !== undefined &&
      pieceMin > pieceMax
    ) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    // brand/piece narrowing shared by every branch (status is handled per-branch: at the search
    // index for the search branch, at the by_status* indexes for the plain ones).
    const matchesFacets = (p: Doc<"puzzles">): boolean =>
      (brand === undefined || p.brand === brand) &&
      (pieceMin === undefined || p.pieceCount >= pieceMin) &&
      (pieceMax === undefined || p.pieceCount <= pieceMax);
    const hasPieceRange = pieceMin !== undefined || pieceMax !== undefined;

    const readPlain = () => {
      // One brand's approved rows, newest first; a piece range filters them, within a bound.
      if (brand !== undefined) {
        const rows = ctx.db
          .query("puzzles")
          .withIndex("by_status_brand", (q) =>
            q.eq("status", "approved").eq("brand", brand),
          )
          .order("desc");
        if (!hasPieceRange) return rows.paginate(paginationOpts);
        return rows
          .filter((q) =>
            q.and(
              ...(pieceMin === undefined
                ? []
                : [q.gte(q.field("pieceCount"), pieceMin)]),
              ...(pieceMax === undefined
                ? []
                : [q.lte(q.field("pieceCount"), pieceMax)]),
            ),
          )
          .paginate({
            ...paginationOpts,
            maximumRowsRead: PUBLIC_CATALOG_FILTER_READS,
          });
      }
      // A piece range alone: every row read is a match, so numItems bounds the read.
      if (hasPieceRange) {
        return ctx.db
          .query("puzzles")
          .withIndex("by_status_pieces", (q) => {
            const approved = q.eq("status", "approved");
            if (pieceMin === undefined)
              return approved.lte("pieceCount", pieceMax!);
            const from = approved.gte("pieceCount", pieceMin);
            return pieceMax === undefined
              ? from
              : from.lte("pieceCount", pieceMax);
          })
          .order("desc")
          .paginate(paginationOpts);
      }
      return ctx.db
        .query("puzzles")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .order("desc") // newest first by _creationTime
        .paginate(paginationOpts);
    };

    const result =
      term.length > 0
        ? await ctx.db
            .query("puzzles")
            .withSearchIndex("by_searchable_text", (q) =>
              q.search("searchableText", term).eq("status", "approved"),
            )
            .filter((q) =>
              q.and(
                brand === undefined
                  ? q.eq(q.field("status"), "approved") // no-op placeholder keeps the AND non-empty
                  : q.eq(q.field("brand"), brand),
                pieceMin === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.gte(q.field("pieceCount"), pieceMin),
                pieceMax === undefined
                  ? q.eq(q.field("status"), "approved")
                  : q.lte(q.field("pieceCount"), pieceMax),
              ),
            )
            .paginate(paginationOpts)
        : await readPlain();

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
