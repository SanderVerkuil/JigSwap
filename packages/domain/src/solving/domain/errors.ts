import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Solving aggregate operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried in a
// Result interchangeably (mirrors LibraryError / ExchangeError).
export type SolvingErrorCode =
  | "InvalidTimeRange"
  | "TooManyPhotos"
  | "EditWindowClosed"
  | "NotCompletionOwner"
  | "InvalidGoalTarget"
  | "InvalidRating"
  | "InvalidDuration";

export class SolvingError extends DomainError {
  override readonly name = "SolvingError";

  private constructor(
    readonly code: SolvingErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A completion's end instant precedes its start instant.
  static invalidTimeRange(): SolvingError {
    return new SolvingError(
      "InvalidTimeRange",
      "A completion's end date must be on or after its start date",
    );
  }

  // A completion may hold at most five photos (§1.4).
  static tooManyPhotos(max: number): SolvingError {
    return new SolvingError(
      "TooManyPhotos",
      `A completion may hold at most ${max} photos`,
    );
  }

  // Edits are only allowed within 24h of completion (the documented rule).
  static editWindowClosed(): SolvingError {
    return new SolvingError(
      "EditWindowClosed",
      "A completion can only be edited within 24 hours of being recorded",
    );
  }

  // The acting member does not own the completion they tried to mutate.
  static notCompletionOwner(): SolvingError {
    return new SolvingError(
      "NotCompletionOwner",
      "Acting member does not own this completion",
    );
  }

  // A goal's target completions must be a positive integer.
  static invalidGoalTarget(): SolvingError {
    return new SolvingError(
      "InvalidGoalTarget",
      "A goal's target completions must be a positive integer",
    );
  }

  // A star rating outside the 1–5 range.
  static invalidRating(value: number): SolvingError {
    return new SolvingError(
      "InvalidRating",
      `A star rating must be an integer from 1 to 5 (got ${value})`,
    );
  }

  // A solve duration that is not a positive number of minutes.
  static invalidDuration(): SolvingError {
    return new SolvingError(
      "InvalidDuration",
      "A solve duration must be a positive number of minutes",
    );
  }
}
