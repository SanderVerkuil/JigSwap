import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Social entity operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried in a
// Result interchangeably. Cross-aggregate failures (already-following, not-following) depend on
// the repository and are orchestration concerns that live in the application layer, not here.
export type SocialErrorCode = "SelfFollow" | "InvalidDisplayName";

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

  // A profile display name was empty or whitespace-only after trimming.
  static invalidDisplayName(): SocialError {
    return new SocialError(
      "InvalidDisplayName",
      "Display name must not be empty",
    );
  }
}
