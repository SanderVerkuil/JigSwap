import {
  type ExchangeId,
  makeSubmitPartnerReview,
  type MemberId,
  toId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexExchangeCompletionPort } from "./adapters/convexExchangeCompletionPort";
import { convexPartnerReviewRepository } from "./adapters/convexPartnerReviewRepository";
import { convexReputationProfileRepository } from "./adapters/convexReputationProfileRepository";
import {
  partnerReviewIdGenerator,
  reputationProfileIdGenerator,
} from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for submitting a partner review: authenticate (reviewer from auth) -> wire
// adapters -> call the use case -> return the new PartnerReviewId (aggregateId). The use case
// gates on the Exchange seam (completed + parties match), enforces one-review-per-reviewer-per-
// exchange, runs the entity rules (self-review, rating bounds), and folds the review into the
// reviewee's ReputationProfile in the SAME transaction. `exchangeId` is the Exchange aggregateId
// (a string); the repository/port resolve it to the real FK document id. `revieweeId` is a user
// `_id`, which is the domain MemberId directly.
export const submitPartnerReview = mutation({
  args: {
    exchangeId: v.string(),
    revieweeId: v.id("users"),
    rating: v.number(),
    comment: v.optional(v.string()),
    scores: v.object({
      communication: v.number(),
      packaging: v.number(),
      condition: v.number(),
      timeliness: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const reviewerId = await requireMember(ctx);

    const submit = makeSubmitPartnerReview({
      reviews: convexPartnerReviewRepository(ctx),
      profiles: convexReputationProfileRepository(ctx),
      exchanges: convexExchangeCompletionPort(ctx),
      reviewIds: partnerReviewIdGenerator,
      profileIds: reputationProfileIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await submit({
      exchangeId: toId<"ExchangeId">(args.exchangeId) as ExchangeId,
      reviewerId: reviewerId as unknown as MemberId,
      revieweeId: toId<"MemberId">(args.revieweeId) as MemberId,
      rating: args.rating,
      comment: args.comment,
      scores: args.scores,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
