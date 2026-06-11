import { DomainError } from "../../shared-kernel";
import { CircleId } from "../domain";

// Orchestration-level failures the Circle aggregate cannot express because they depend on the
// world (a repository lookup) rather than its own data. Like SharingError, the `code` is the
// stable, machine-readable discriminant a transport adapter maps to; the message is for
// logs/tests only.
export type SharingApplicationErrorCode = "CircleNotFound";

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
}
