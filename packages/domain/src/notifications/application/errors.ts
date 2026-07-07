import { DomainError } from "../../shared-kernel";
import { MemberId, NotificationId } from "../domain";

// Orchestration-level failures the aggregates cannot express because they depend on the world
// (whether a row exists) rather than the aggregate's own data. Like NotificationError, the `code`
// is the stable, machine-readable discriminant a transport adapter maps to; the message is for
// logs/tests only.
export type NotificationApplicationErrorCode =
  "NotificationNotFound" | "PreferenceNotFound";

export class NotificationApplicationError extends DomainError {
  override readonly name = "NotificationApplicationError";

  private constructor(
    readonly code: NotificationApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // No notification exists for the given id.
  static notificationNotFound(
    id: NotificationId,
  ): NotificationApplicationError {
    return new NotificationApplicationError(
      "NotificationNotFound",
      `Notification ${id} could not be found`,
    );
  }

  // No stored preference exists for the given member (used by flows that require an existing one;
  // NotifyMember instead materialises a default rather than failing).
  static preferenceNotFound(member: MemberId): NotificationApplicationError {
    return new NotificationApplicationError(
      "PreferenceNotFound",
      `Notification preference for member ${member} could not be found`,
    );
  }
}
