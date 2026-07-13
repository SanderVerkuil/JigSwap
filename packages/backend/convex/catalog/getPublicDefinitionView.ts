import type { PublicDefinitionDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import {
  categoryNameOf,
  completionStatsOf,
  publicAvailabilityOf,
  ratingBreakdownOf,
} from "../library/definitionAggregates";

// UNAUTHENTICATED catalog detail for the public /catalog/$id page. Approved-only (the standard
// catalog leak gate) and strictly member-free: catalog facts, the community rating breakdown,
// completion stats, and the PUBLIC availability aggregate — never owner identities, copy rows,
// prices, or locations. The availability number intentionally differs from the member-facing
// getPuzzleDefinitionView (no circle reachability, no viewer-own exclusion); see
// publicAvailabilityOf. Members never see this page — the web route redirects them to /puzzles/$id.
export const getPublicDefinitionView = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicDefinitionDetailView | null> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || puzzle.status !== "approved") return null;

    const image = puzzle.image
      ? ((await ctx.storage.getUrl(puzzle.image)) ?? undefined)
      : undefined;
    const categoryRow = puzzle.category
      ? await ctx.db.get(puzzle.category)
      : null;

    const rating = await ratingBreakdownOf(ctx, args.puzzleId);

    const owned = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
      .collect();
    const communityOwners = new Set(
      owned.map((c) => c.ownerId as unknown as string),
    ).size;
    const availability = await publicAvailabilityOf(ctx, owned);
    const { totalCompletions, avgCompletionDays } = await completionStatsOf(
      ctx,
      args.puzzleId,
      owned,
    );

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
