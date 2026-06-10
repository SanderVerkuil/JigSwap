import {
  type CircleId,
  type CircleIdGenerator,
  type MembershipId,
  type MembershipIdGenerator,
  toCircleId,
  toMembershipId,
} from "@jigswap/domain";

// Driven adapters for the Sharing id-generator ports. crypto.randomUUID is available in the Convex
// runtime; the circle value is branded and persisted as the aggregate's `aggregateId`.
export const circleIdGenerator: CircleIdGenerator = {
  next: (): CircleId => toCircleId(crypto.randomUUID()),
};

export const membershipIdGenerator: MembershipIdGenerator = {
  next: (): MembershipId => toMembershipId(crypto.randomUUID()),
};
