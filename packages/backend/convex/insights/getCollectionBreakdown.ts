import { computeCollectionBreakdown } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Insights read query: distributions over the member's owned copies (piece-count bucket, brand,
// difficulty, condition) for the collection charts. Brand/piece count come from the copy's cached
// catalog snapshot when present; difficulty lives on the puzzle definition, so we resolve the
// puzzle row (de-duplicated) for the difficulty facet.
export const getCollectionBreakdown = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    // Resolve each distinct puzzle once for brand/pieceCount/difficulty fallback.
    const puzzleIds = [...new Set(copies.map((c) => c.puzzleId))];
    const puzzles = await Promise.all(puzzleIds.map((id) => ctx.db.get(id)));
    const puzzleById = new Map<Id<"puzzles">, (typeof puzzles)[number]>(
      puzzleIds.map((id, i) => [id, puzzles[i]]),
    );

    const inputs = copies.map((copy) => {
      const puzzle = puzzleById.get(copy.puzzleId);
      return {
        // Prefer the copy's snapshot, fall back to the live puzzle row.
        pieceCount: copy.snapshot?.pieceCount ?? puzzle?.pieceCount,
        brand: copy.snapshot?.brand ?? puzzle?.brand,
        difficulty: puzzle?.difficulty,
        condition: copy.condition,
      };
    });

    return computeCollectionBreakdown(inputs);
  },
});
