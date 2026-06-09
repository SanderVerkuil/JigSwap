import { DomainError } from "../../shared-kernel";
import { MemberId } from "../domain";

// Orchestration-level failures the aggregates cannot express because they depend on the world
// (existing follow edges, a member's stored profile) rather than the aggregate's own data. Like
// SocialError, the `code` is the stable, machine-readable discriminant a transport adapter maps
// to; the message is for logs/tests only.
export type SocialApplicationErrorCode =
  | "AlreadyFollowing"
  | "NotFollowing"
  | "ProfileNotFound";

export class SocialApplicationError extends DomainError {
  override readonly name = "SocialApplicationError";

  private constructor(
    readonly code: SocialApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A follow edge already exists for this (follower, followee) pair (pair-uniqueness).
  static alreadyFollowing(
    followerId: MemberId,
    followeeId: MemberId,
  ): SocialApplicationError {
    return new SocialApplicationError(
      "AlreadyFollowing",
      `Member ${followerId} already follows ${followeeId}`,
    );
  }

  // No follow edge exists for this (follower, followee) pair, so it cannot be unfollowed.
  static notFollowing(
    followerId: MemberId,
    followeeId: MemberId,
  ): SocialApplicationError {
    return new SocialApplicationError(
      "NotFollowing",
      `Member ${followerId} does not follow ${followeeId}`,
    );
  }

  // No profile exists for the member whose profile an edit targeted.
  static profileNotFound(memberId: MemberId): SocialApplicationError {
    return new SocialApplicationError(
      "ProfileNotFound",
      `No profile exists for member ${memberId}`,
    );
  }
}
