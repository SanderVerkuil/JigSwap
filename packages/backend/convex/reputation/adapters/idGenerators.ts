import {
  type PartnerReviewId,
  type PartnerReviewIdGenerator,
  type ReputationProfileId,
  type ReputationProfileIdGenerator,
  toPartnerReviewId,
  toReputationProfileId,
} from "@jigswap/domain";

// Driven adapters for the Reputation id-generator ports. crypto.randomUUID is available in the
// Convex runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const partnerReviewIdGenerator: PartnerReviewIdGenerator = {
  next: (): PartnerReviewId => toPartnerReviewId(crypto.randomUUID()),
};

export const reputationProfileIdGenerator: ReputationProfileIdGenerator = {
  next: (): ReputationProfileId => toReputationProfileId(crypto.randomUUID()),
};
