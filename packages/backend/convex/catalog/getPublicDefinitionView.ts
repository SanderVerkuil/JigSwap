import type { PublicDefinitionDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import {
  categoryNameOf,
  completionStatsFromTotals,
  publicAvailabilityFromByType,
  ratingBreakdownFromTotals,
} from "../library/definitionAggregates";
import { definitionTotalsOrLive } from "../library/definitionStats";

// UNAUTHENTICATED catalog detail for the public /catalog/$id page. Approved-only (the standard
// catalog leak gate) and strictly member-free: catalog facts, the community rating breakdown,
// completion stats, and the PUBLIC availability aggregate — never owner identities, copy rows,
// prices, or locations. The availability number intentionally differs from the member-facing
// getPuzzleDefinitionView (no circle reachability, no viewer-own exclusion); see
// publicAvailabilityOf. Members never see this page — the web route redirects them to /puzzles/$id.
// The aggregates come from the definition's definitionStats row (library/definitionStats), so the
// page reads a fixed handful of documents however many reviews, copies and solves it has.
export const getPublicDefinitionView = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicDefinitionDetailView | null> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || puzzle.status !== "approved") return null;

    const image = puzzle.image
      ? ((await boxArtUrl(ctx, puzzle.image)) ?? undefined)
      : undefined;
    const categoryRow = puzzle.category
      ? await ctx.db.get(puzzle.category)
      : null;

    // No viewer: private copies never count (they never do in the stored totals).
    const totals = await definitionTotalsOrLive(ctx, args.puzzleId);
    const rating = ratingBreakdownFromTotals(totals);
    const communityOwners = totals.communityOwners;
    const availability = publicAvailabilityFromByType(totals.publicAvailable);
    const { totalCompletions, avgCompletionDays } =
      completionStatsFromTotals(totals);

    return {
      definition: {
        title: puzzle.title,
        description: puzzle.description,
        brand: puzzle.brand,
        publisher: puzzle.publisher,
        artist: puzzle.artist,
        series: puzzle.series,
        pieceCount: puzzle.pieceCount,
        image,
        difficulty: puzzle.difficulty,
        categoryName: categoryNameOf(categoryRow),
        tags: puzzle.tags ?? [],
        shape: puzzle.shape,
        dimensions: puzzle.dimensions,
      },
      rating,
      stats: { communityOwners, totalCompletions, avgCompletionDays },
      availability,
    };
  },
});
