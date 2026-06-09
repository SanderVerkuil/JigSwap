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
  | "DuplicatePermission";

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
    return new SharingError("NotAMember", "That member does not belong to this circle");
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
}
