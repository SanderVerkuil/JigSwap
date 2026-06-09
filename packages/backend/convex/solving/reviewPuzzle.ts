import {
  type CompletionId,
  makeReviewPuzzle,
  type MemberId,
  toId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for attaching a PuzzleReview (opinion of the puzzle) to a completion:
// authenticate -> wire adapters -> call the use case (loads, checks ownership, validates the 1–5
// rating, attaches the review -> PuzzleReviewed) -> map result.
export const reviewPuzzle = mutation({
  args: {
    completionId: v.string(),
    rating: v.number(),
    text: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const review = makeReviewPuzzle({
      completions: convexCompletionRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await review({
      actingMemberId: actingMemberId as unknown as MemberId,
      completionId: toId<"CompletionId">(args.completionId) as CompletionId,
      rating: args.rating,
      text: args.text,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
