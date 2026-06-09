import {
  type ExchangeId,
  type MemberId,
  PartnerReview,
  type PartnerReviewState,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `reviews` row and the PartnerReview aggregate. Schema shape stops
// here and never ripples into the domain.

// The insert/patch payload for the review row (minus Convex-managed `_id`/`_creationTime`). The
// `exchangeId` FK column is excluded because the mapper is pure and cannot resolve the real
// `exchanges._id` from the ExchangeId aggregateId — the repository resolves and supplies it.
// `reviewerId`/`revieweeId` ARE included: they are user `_id`s, which the domain carries directly
// as MemberIds, so no lookup is needed.
export type ReviewRow = Omit<Doc<"reviews">, "_id" | "_creationTime" | "exchangeId">;

// Row -> aggregate. The row MUST carry an aggregateId (only domain-written/backfilled rows do);
// callers guard for it before mapping. `exchangeId` is the OUTBOUND ExchangeId aggregateId,
// supplied by the repository after mapping the stored FK `_id` back to it.
export const toDomain = (row: Doc<"reviews">, exchangeId: ExchangeId): PartnerReview => {
  const state: PartnerReviewState = {
    id: toId<"PartnerReviewId">(row.aggregateId as string),
    exchangeId,
    reviewerId: toId<"MemberId">(row.reviewerId as unknown as string) as MemberId,
    revieweeId: toId<"MemberId">(row.revieweeId as unknown as string) as MemberId,
    // StarRating is structurally a `{ value }`; rehydrate skips re-validation by design.
    rating: { value: row.rating } as PartnerReviewState["rating"],
    comment: row.comment,
    scores: {
      communication: { value: row.categories.communication },
      packaging: { value: row.categories.packaging },
      condition: { value: row.categories.condition },
      timeliness: { value: row.categories.timeliness },
    } as PartnerReviewState["scores"],
    createdAt: new Date(row.createdAt),
  };
  return PartnerReview.rehydrate(state);
};

// Aggregate -> review row payload (without the `exchangeId` FK column, which the repository fills
// with the resolved real document id). The four category sub-scores map to `categories{...}`.
export const toRow = (review: PartnerReview): ReviewRow => {
  const state: PartnerReviewState = review.toState();
  return {
    aggregateId: state.id as string,
    reviewerId: state.reviewerId as unknown as Id<"users">,
    revieweeId: state.revieweeId as unknown as Id<"users">,
    rating: state.rating.value,
    comment: state.comment,
    categories: {
      communication: state.scores.communication.value,
      packaging: state.scores.packaging.value,
      condition: state.scores.condition.value,
      timeliness: state.scores.timeliness.value,
    },
    createdAt: state.createdAt.getTime(),
  };
};
