import { DomainError } from "../../shared-kernel";
import { MemberId } from "../domain";

// Orchestration-level failures the Member aggregate cannot express because they depend on the
// world (whether a Member exists for a clerkId / id) rather than the Member's own data. Like
// IdentityError, the `code` is the stable, machine-readable discriminant a transport adapter
// maps to; the message is for logs/tests only.
export type IdentityApplicationErrorCode =
  | "MemberNotFound"
  | "AlreadyRegistered";

export class IdentityApplicationError extends DomainError {
  override readonly name = "IdentityApplicationError";

  private constructor(
    readonly code: IdentityApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // No Member exists for the referenced id (update/deactivate/role command on an unknown member).
  static memberNotFound(memberId: MemberId): IdentityApplicationError {
    return new IdentityApplicationError(
      "MemberNotFound",
      `No member found for id ${memberId}`,
    );
  }

  // A Member already exists for this Clerk subject. RegisterMember is idempotent and returns the
  // existing member rather than erroring, so this is reserved for callers that require a strictly
  // first-time registration.
  static alreadyRegistered(clerkId: string): IdentityApplicationError {
    return new IdentityApplicationError(
      "AlreadyRegistered",
      `A member already exists for Clerk subject ${clerkId}`,
    );
  }
}
