import { PartnerReviewId, ReputationProfileId } from "../../../domain";

// Outbound ports: minting new aggregate ids. The aggregates take their id as input (they are
// pure and do no I/O), so the use case obtains one here. The 1b-convex adapter can back these
// with a pre-inserted document id or a uuid.
export interface PartnerReviewIdGenerator {
  next(): PartnerReviewId;
}

export interface ReputationProfileIdGenerator {
  next(): ReputationProfileId;
}
