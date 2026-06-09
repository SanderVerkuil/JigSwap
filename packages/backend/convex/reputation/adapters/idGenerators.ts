import {
  type PartnerReviewId,
  type PartnerReviewIdGenerator,
  type ReputationProfileId,
  type ReputationProfileIdGenerator,
  toId,
} from "@jigswap/domain";

// Driven adapters for the Reputation id-generator ports. crypto.randomUUID is available in the
// Convex runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const partnerReviewIdGenerator: PartnerReviewIdGenerator = {
  next: (): PartnerReviewId => toId<"PartnerReviewId">(crypto.randomUUID()),
};

export const reputationProfileIdGenerator: ReputationProfileIdGenerator = {
  next: (): ReputationProfileId => toId<"ReputationProfileId">(crypto.randomUUID()),
};
