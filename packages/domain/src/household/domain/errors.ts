import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Household entity operation can fail; `code` is the stable discriminant
// the transport adapter maps to. Cross-aggregate failures (already in a household, household not
// found) depend on persistence and live in the application layer.
export type HouseholdErrorCode =
  | "AlreadyMember"
  | "NotAMember"
  | "NotHouseholdAdmin"
  | "CannotRemoveSelf"
  | "SelfInvite"
  | "NotInvitee"
  | "InviteNotPending"
  | "NotCopyOwner"
  | "PermissionBatchTooLarge"
  | "InvalidHouseholdName"
  | "SelfJoinRequest"
  | "NotRequester"
  | "JoinRequestNotPending";

export class HouseholdError extends DomainError {
  override readonly name = "HouseholdError";

  private constructor(
    readonly code: HouseholdErrorCode,
    message: string,
  ) {
    super(message);
  }

  static alreadyMember(): HouseholdError {
    return new HouseholdError(
      "AlreadyMember",
      "This member already belongs to the household",
    );
  }

  static notAMember(): HouseholdError {
    return new HouseholdError(
      "NotAMember",
      "This member does not belong to the household",
    );
  }

  static notHouseholdAdmin(): HouseholdError {
    return new HouseholdError(
      "NotHouseholdAdmin",
      "Only the household admin may do this",
    );
  }

  static cannotRemoveSelf(): HouseholdError {
    return new HouseholdError(
      "CannotRemoveSelf",
      "Leave the household instead of removing yourself",
    );
  }

  static selfInvite(): HouseholdError {
    return new HouseholdError("SelfInvite", "You cannot invite yourself");
  }

  static notInvitee(): HouseholdError {
    return new HouseholdError(
      "NotInvitee",
      "Only the invited member may respond to this invite",
    );
  }

  static inviteNotPending(): HouseholdError {
    return new HouseholdError(
      "InviteNotPending",
      "This household invite has already been answered",
    );
  }

  static notCopyOwner(): HouseholdError {
    return new HouseholdError(
      "NotCopyOwner",
      "Only the owner can change this copy's household access",
    );
  }

  static permissionBatchTooLarge(max: number): HouseholdError {
    return new HouseholdError(
      "PermissionBatchTooLarge",
      `At most ${max} copies can be changed at once`,
    );
  }

  static invalidHouseholdName(): HouseholdError {
    return new HouseholdError(
      "InvalidHouseholdName",
      "A household name must be between 1 and 100 characters",
    );
  }

  static selfJoinRequest(): HouseholdError {
    return new HouseholdError(
      "SelfJoinRequest",
      "You cannot ask to join through your own link",
    );
  }

  static notRequester(): HouseholdError {
    return new HouseholdError(
      "NotRequester",
      "Only the member who asked may withdraw this request",
    );
  }

  static joinRequestNotPending(): HouseholdError {
    return new HouseholdError(
      "JoinRequestNotPending",
      "This request to join is no longer open",
    );
  }
}
