import { Result } from "../../../../shared-kernel";
import {
  ExchangeId,
  MemberId,
  PartnerReviewId,
  PartnerReviewScoresInput,
  ReputationError,
} from "../../../domain";
import { ReputationApplicationError } from "../../errors";

// The command to submit a partner review. `reviewerId` is resolved from auth by the transport
// adapter. The overall `rating` and category sub-scores arrive as raw numbers and are
// validated by the PartnerReview aggregate.
export interface SubmitPartnerReviewCommand {
  readonly exchangeId: ExchangeId;
  readonly reviewerId: MemberId;
  readonly revieweeId: MemberId;
  readonly rating: number;
  readonly comment?: string;
  readonly scores: PartnerReviewScoresInput;
}

// Inbound port: the submit-partner-review use case. Yields the new review's id on success.
export interface SubmitPartnerReview {
  (
    cmd: SubmitPartnerReviewCommand,
  ): Promise<
    Result<PartnerReviewId, ReputationError | ReputationApplicationError>
  >;
}
