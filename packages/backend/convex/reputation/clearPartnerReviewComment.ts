import { makeClearPartnerReviewComment, toExchangeId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexPartnerReviewRepository } from "./adapters/convexPartnerReviewRepository";
import { toConvexError } from "./errors";

// Composition root for "Remove comment" on the member's own partner review (SEC-70). The reviewer
// comes from auth, never the client; one review per reviewer per exchange, so `exchangeId` (the
// Exchange aggregateId, resolved to the FK by the repository) and the caller identify it. Only the
// written comment goes: the overall rating and category scores stay, so the reviewee's
// ReputationProfile is untouched. PartnerReviewNotFound when the caller has no review of it.
export const clearPartnerReviewComment = mutation({
  args: { exchangeId: v.string() },
  handler: async (ctx, args) => {
    const reviewerId = await requireMember(ctx);

    const clearPartnerReviewCommentUseCase = makeClearPartnerReviewComment({
      reviews: convexPartnerReviewRepository(ctx),
    });
    const result = await clearPartnerReviewCommentUseCase({
      exchangeId: toExchangeId(args.exchangeId),
      reviewerId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
