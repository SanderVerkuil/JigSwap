import { DomainError } from "../../shared-kernel";
import { ExchangeId, MemberId } from "../domain";

// Orchestration-level failures the aggregate cannot express because they depend on the world
// (Exchange's state, prior reviews) rather than the PartnerReview's own data. Like
// ReputationError, the `code` is the stable, machine-readable discriminant a transport
// adapter maps to; the message is for logs/tests only.
export type ReputationApplicationErrorCode =
  | "ExchangeNotCompleted"
  | "NotExchangeParticipant"
  | "DuplicatePartnerReview";

export class ReputationApplicationError extends DomainError {
  override readonly name = "ReputationApplicationError";

  private constructor(
    readonly code: ReputationApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // The referenced exchange is not completed (no review window is open). The
  // ExchangeCompletionPort returns false both for not-yet-completed and for unknown exchanges,
  // and also when the parties don't match; the use case maps a party mismatch separately when
  // it can distinguish it. This code covers the completed-state failure.
  static exchangeNotCompleted(
    exchangeId: ExchangeId,
  ): ReputationApplicationError {
    return new ReputationApplicationError(
      "ExchangeNotCompleted",
      `Exchange ${exchangeId} is not completed; no review window is open`,
    );
  }

  // The reviewer or reviewee was not a party to the completed exchange.
  static notExchangeParticipant(
    exchangeId: ExchangeId,
    member: MemberId,
  ): ReputationApplicationError {
    return new ReputationApplicationError(
      "NotExchangeParticipant",
      `Member ${member} was not a party to exchange ${exchangeId}`,
    );
  }

  // This reviewer already submitted a review for this exchange (one per party per exchange).
  static duplicatePartnerReview(
    exchangeId: ExchangeId,
  ): ReputationApplicationError {
    return new ReputationApplicationError(
      "DuplicatePartnerReview",
      `A review already exists for this reviewer on exchange ${exchangeId}`,
    );
  }
}
