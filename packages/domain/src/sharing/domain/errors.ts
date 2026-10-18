import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Sharing aggregate operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for logs/tests
// only). Modelled as a DomainError subclass so it can be thrown or carried in a Result
// interchangeably (mirrors ReputationError / SolvingError). Cross-aggregate failures (e.g.
// circle-not-found) are orchestration concerns and live in the application layer, not here.
export type SharingErrorCode =
  | "NotCircleAdmin"
  | "AlreadyMember"
  | "NotAMember"
  | "CannotRemoveOwner"
  | "DuplicatePermission"
  | "OwnerCannotLeave"
  | "CircleFull"
  | "CannotInvite"
  | "NotInvitee"
  | "InviteNotPending"
  | "InviteExpired"
  | "InviteNotDue"
  | "InviteNotAccepted"
  | "CannotRevokeInvite"
  | "NotCircleOwner"
  | "ConfirmationMismatch"
  | "InvalidCircleName";

export class SharingError extends DomainError {
  override readonly name = "SharingError";

  private constructor(
    readonly code: SharingErrorCode,
    message: string,
  ) {
    super(message);
  }

  // Only a member holding Admin permission (the owner is implicitly Admin) may manage membership.
  static notCircleAdmin(): SharingError {
    return new SharingError(
      "NotCircleAdmin",
      "Only a circle admin may manage members or permissions",
    );
  }

  // The member being added is already in the circle (no duplicate membership per member).
  static alreadyMember(): SharingError {
    return new SharingError(
      "AlreadyMember",
      "That member already belongs to this circle",
    );
  }

  // The target member is not in the circle, so it cannot be removed or re-permissioned.
  static notAMember(): SharingError {
    return new SharingError(
      "NotAMember",
      "That member does not belong to this circle",
    );
  }

  // The owner's membership is permanent: it can never be removed from the circle.
  static cannotRemoveOwner(): SharingError {
    return new SharingError(
      "CannotRemoveOwner",
      "The circle owner cannot be removed from the circle",
    );
  }

  // A permission change that would leave the member at the permission they already hold.
  static duplicatePermission(): SharingError {
    return new SharingError(
      "DuplicatePermission",
      "That member already holds the requested permission level",
    );
  }

  // The owner's seat is permanent, so the owner cannot walk out of their own circle either.
  static ownerCannotLeave(): SharingError {
    return new SharingError(
      "OwnerCannotLeave",
      "The circle owner cannot leave the circle",
    );
  }

  // The circle already holds MAX_CIRCLE_MEMBERS seats (owner included), so no one else can join.
  static circleFull(): SharingError {
    return new SharingError(
      "CircleFull",
      "This circle has reached its member limit",
    );
  }

  // The invitee may not be invited (self, or the contact rule refused). Deliberately ONE code for
  // every reason, so a refusal never tells the inviter which condition failed (e.g. a block).
  static cannotInvite(): SharingError {
    return new SharingError(
      "CannotInvite",
      "This member can't be invited to the circle",
    );
  }

  // Only the invitee may answer (accept or decline) a circle invite.
  static notInvitee(): SharingError {
    return new SharingError(
      "NotInvitee",
      "Only the invited member may answer this invite",
    );
  }

  // The invite was already accepted, declined, revoked or expired.
  static inviteNotPending(): SharingError {
    return new SharingError(
      "InviteNotPending",
      "This invite is no longer pending",
    );
  }

  // The invite is still marked pending but its expiry has passed (expiry is applied lazily).
  static inviteExpired(): SharingError {
    return new SharingError("InviteExpired", "This invite has expired");
  }

  // An expiry was attempted before the invite's expiresAt.
  static inviteNotDue(): SharingError {
    return new SharingError(
      "InviteNotDue",
      "This invite has not reached its expiry yet",
    );
  }

  // Admission needs an invite to THIS circle that its invitee has accepted.
  static inviteNotAccepted(): SharingError {
    return new SharingError(
      "InviteNotAccepted",
      "This invite has not been accepted for this circle",
    );
  }

  // Only the inviter or a current Admin of the circle may revoke an invite.
  static cannotRevokeInvite(): SharingError {
    return new SharingError(
      "CannotRevokeInvite",
      "Only the inviter or a circle admin may revoke this invite",
    );
  }

  // Only the circle's owner may delete it; an Admin seat is not enough.
  static notCircleOwner(): SharingError {
    return new SharingError(
      "NotCircleOwner",
      "Only the circle owner may delete the circle",
    );
  }

  // Deleting a circle needs its exact name typed back, a guard against accidental or scripted calls.
  static confirmationMismatch(): SharingError {
    return new SharingError(
      "ConfirmationMismatch",
      "The confirmation does not match the circle's name",
    );
  }

  // A new circle's name, once trimmed, must be 1 to MAX_CIRCLE_NAME_LENGTH characters.
  static invalidCircleName(): SharingError {
    return new SharingError(
      "InvalidCircleName",
      "A circle name must be between 1 and 100 characters",
    );
  }
}
