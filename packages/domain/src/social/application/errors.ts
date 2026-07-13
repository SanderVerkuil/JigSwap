import { DomainError } from "../../shared-kernel";
import { MemberId } from "../domain";

// Orchestration-level failures the aggregates cannot express because they depend on the world
// (existing follow edges, a member's stored profile) rather than the aggregate's own data. Like
// SocialError, the `code` is the stable, machine-readable discriminant a transport adapter maps
// to; the message is for logs/tests only.
export type SocialApplicationErrorCode =
  | "AlreadyFollowing"
  | "NotFollowing"
  | "ProfileNotFound"
  | "RequestNotFound"
  | "NotRequestTarget"
  | "NotRequestOwner";

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

  // No follow request exists with the given id.
  static requestNotFound(): SocialApplicationError {
    return new SocialApplicationError(
      "RequestNotFound",
      "No such follow request",
    );
  }

  // Only the member the request targets may approve or decline it.
  static notRequestTarget(): SocialApplicationError {
    return new SocialApplicationError(
      "NotRequestTarget",
      "Only the requested member can resolve this follow request",
    );
  }

  // Only the member who sent the request may cancel it.
  static notRequestOwner(): SocialApplicationError {
    return new SocialApplicationError(
      "NotRequestOwner",
      "Only the requesting member can cancel this follow request",
    );
  }
}
