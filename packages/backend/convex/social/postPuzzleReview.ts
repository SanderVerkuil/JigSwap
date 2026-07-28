import { makeUpsertPuzzleReview, toPuzzleDefinitionId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexPuzzleReviewRepository } from "../solving/adapters/convexReviewRepositories";
import { inProcessEventPublisher } from "../solving/adapters/inProcessEventPublisher";
import { systemClock } from "../solving/adapters/systemClock";
import { toConvexError } from "../solving/errors";

// Composition root for the catalog "write a review" form: upsert the caller's SINGLE
// `puzzleReviews` row for the puzzle definition (one review per member per puzzle), replacing the
// old append-only rated `puzzleComments` write. Same wiring as solving/submitReviews: the branded
// PuzzleDefinitionId CARRIES the Convex doc `_id` (the adapter casts back, no resolution). Rating
// is required; text optional — the 1–5 validation and whitespace normalisation live in the domain
// use case. The author is derived from auth, never the client.
export const postPuzzleReview = mutation({
  args: {
    puzzleId: v.id("puzzles"),
    rating: v.number(),
    text: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    const upsertPuzzleReviewUseCase = makeUpsertPuzzleReview({
      puzzleReviews: convexPuzzleReviewRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await upsertPuzzleReviewUseCase({
      actingMemberId: memberId,
      puzzleId: toPuzzleDefinitionId(args.puzzleId as unknown as string),
      rating: args.rating,
      text: args.text,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
