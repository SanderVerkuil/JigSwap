import { DomainError } from "../../shared-kernel";

// Orchestration failures that depend on persisted state (other households, other invites) rather
// than one aggregate's own data. `code` is the stable discriminant the transport maps to.
export type HouseholdApplicationErrorCode =
  | "AlreadyInHousehold"
  | "NotInHousehold"
  | "DuplicateInvite"
  | "InviteNotFound"
  | "HouseholdNotFound"
  | "JoinRequestNotFound"
  | "JoinRequestOpen"
  | "JoinRequestAlreadySent";

export class HouseholdApplicationError extends DomainError {
  override readonly name = "HouseholdApplicationError";

  private constructor(
    readonly code: HouseholdApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A member belongs to at most one household.
  static alreadyInHousehold(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "AlreadyInHousehold",
      "You are already in a household",
    );
  }

  static notInHousehold(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "NotInHousehold",
      "You are not in a household",
    );
  }

  static duplicateInvite(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "DuplicateInvite",
      "This member already has a pending invite to your household",
    );
  }

  static inviteNotFound(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "InviteNotFound",
      "No such household invite",
    );
  }

  static householdNotFound(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "HouseholdNotFound",
      "This household no longer exists",
    );
  }

  static joinRequestNotFound(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "JoinRequestNotFound",
      "No such request to join",
    );
  }

  // A member has at most one open request to join at a time.
  static joinRequestOpen(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "JoinRequestOpen",
      "You already have an open request to join a household",
    );
  }

  // One request per invite link, ever.
  static joinRequestAlreadySent(): HouseholdApplicationError {
    return new HouseholdApplicationError(
      "JoinRequestAlreadySent",
      "You already asked to join through this link",
    );
  }
}
