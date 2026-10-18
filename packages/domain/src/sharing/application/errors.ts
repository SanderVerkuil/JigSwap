import { DomainError } from "../../shared-kernel";
import { CircleId } from "../domain";

// Orchestration-level failures the Circle aggregate cannot express because they depend on the
// world (a repository lookup) rather than its own data. Like SharingError, the `code` is the
// stable, machine-readable discriminant a transport adapter maps to; the message is for
// logs/tests only.
export type SharingApplicationErrorCode = "CircleNotFound" | "InviteNotFound";

export class SharingApplicationError extends DomainError {
  override readonly name = "SharingApplicationError";

  private constructor(
    readonly code: SharingApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  static circleNotFound(id: CircleId): SharingApplicationError {
    return new SharingApplicationError(
      "CircleNotFound",
      `Circle ${id} could not be found`,
    );
  }

  // One generic answer for an invite the actor may not act on: unknown, addressed to someone else,
  // or (on accept) no longer honourable for a reason the invitee must not learn (a block, the
  // inviter losing Admin, the circle gone). Never reveals that an invite exists for someone else.
  static inviteNotFound(): SharingApplicationError {
    return new SharingApplicationError(
      "InviteNotFound",
      "No such circle invite",
    );
  }
}
