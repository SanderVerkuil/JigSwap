import { makeDeletePuzzleReview, toPuzzleDefinitionId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexPuzzleReviewRepository } from "../solving/adapters/convexReviewRepositories";
import { toConvexError } from "../solving/errors";

// Composition root for "Delete my review" on the catalog page (SEC-70): delete the caller's
// single `puzzleReviews` row for the puzzle definition, stars and text. The member comes from
// auth, never the client, and the (member, puzzle) pair is the review's key, so a member can only
// ever delete their own. PuzzleReviewNotFound when they have none. The community rating is
// computed from the remaining rows on read (library/definitionAggregates).
export const deletePuzzleReview = mutation({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    const deletePuzzleReviewUseCase = makeDeletePuzzleReview({
      puzzleReviews: convexPuzzleReviewRepository(ctx),
    });
    const result = await deletePuzzleReviewUseCase({
      actingMemberId: memberId,
      puzzleId: toPuzzleDefinitionId(args.puzzleId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
