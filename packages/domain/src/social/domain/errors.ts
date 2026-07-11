import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Social entity operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried in a
// Result interchangeably. Cross-aggregate failures (already-following, not-following) depend on
// the repository and are orchestration concerns that live in the application layer, not here.
export type SocialErrorCode =
  | "SelfFollow"
  | "RequestNotPending"
  | "InvalidDisplayName"
  | "EmptyCommentText"
  | "InvalidCommentRating";

export class SocialError extends DomainError {
  override readonly name = "SocialError";

  private constructor(
    readonly code: SocialErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A member cannot follow themselves: follower and followee must differ.
  static selfFollow(): SocialError {
    return new SocialError("SelfFollow", "A member cannot follow themselves");
  }

  // A follow request can only be approved or declined while it is still pending.
  static requestNotPending(): SocialError {
    return new SocialError(
      "RequestNotPending",
      "This follow request has already been resolved",
    );
  }

  // A profile display name was empty or whitespace-only after trimming.
  static invalidDisplayName(): SocialError {
    return new SocialError(
      "InvalidDisplayName",
      "Display name must not be empty",
    );
  }

  // A comment's text was empty or whitespace-only after trimming.
  static emptyCommentText(): SocialError {
    return new SocialError(
      "EmptyCommentText",
      "Comment text must not be empty",
    );
  }

  // A comment's optional rating was present but not an integer in the 1–5 range.
  static invalidCommentRating(value: number): SocialError {
    return new SocialError(
      "InvalidCommentRating",
      `Comment rating must be an integer between 1 and 5, got ${value}`,
    );
  }
}
