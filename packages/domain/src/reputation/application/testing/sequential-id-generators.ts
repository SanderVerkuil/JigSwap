import { toId } from "../../../shared-kernel";
import { PartnerReviewId, ReputationProfileId } from "../../domain";
import {
  PartnerReviewIdGenerator,
  ReputationProfileIdGenerator,
} from "../ports/out/id-generators";

// Deterministic PartnerReviewIdGenerator for tests: review-1, review-2, ...
export class SequentialPartnerReviewIdGenerator implements PartnerReviewIdGenerator {
  private counter = 0;

  next(): PartnerReviewId {
    this.counter += 1;
    return toId<"PartnerReviewId">(`review-${this.counter}`) as PartnerReviewId;
  }
}

// Deterministic ReputationProfileIdGenerator for tests: profile-1, profile-2, ...
export class SequentialReputationProfileIdGenerator
  implements ReputationProfileIdGenerator
{
  private counter = 0;

  next(): ReputationProfileId {
    this.counter += 1;
    return toId<"ReputationProfileId">(`profile-${this.counter}`) as ReputationProfileId;
  }
}
