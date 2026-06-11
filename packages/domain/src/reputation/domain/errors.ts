import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Reputation entity operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried in a
// Result interchangeably. Cross-aggregate failures (e.g. exchange-not-completed) are
// orchestration concerns and live in the application layer, not here.
export type ReputationErrorCode = "SelfReview" | "InvalidRating";

export class ReputationError extends DomainError {
  override readonly name = "ReputationError";

  private constructor(
    readonly code: ReputationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A member cannot review themselves: reviewer and reviewee must differ.
  static selfReview(): ReputationError {
    return new ReputationError(
      "SelfReview",
      "Reviewer and reviewee must be different members",
    );
  }

  // A star rating fell outside the inclusive 1-5 range or was not an integer.
  static invalidRating(value: number): ReputationError {
    return new ReputationError(
      "InvalidRating",
      `Rating ${value} must be an integer between 1 and 5`,
    );
  }
}
