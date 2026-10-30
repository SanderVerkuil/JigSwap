import { Result } from "../../../../shared-kernel";
import { ExchangeId, MemberId, ReputationError } from "../../../domain";
import { ReputationApplicationError } from "../../errors";

// The command to remove the written comment from the member's own review of an exchange.
// `reviewerId` is resolved from auth by the transport adapter; one review per reviewer per
// exchange, so the pair identifies it.
export interface ClearPartnerReviewCommentCommand {
  readonly exchangeId: ExchangeId;
  readonly reviewerId: MemberId;
}

// Inbound port: fails with PartnerReviewNotFound when the member has no review of the exchange.
export interface ClearPartnerReviewComment {
  (
    cmd: ClearPartnerReviewCommentCommand,
  ): Promise<Result<void, ReputationError | ReputationApplicationError>>;
}
