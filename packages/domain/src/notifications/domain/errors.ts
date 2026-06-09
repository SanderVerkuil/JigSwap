import { DomainError } from "../../shared-kernel";
import { MemberId, NotificationId } from "./ids";

// A closed set of reasons a Notification domain operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for logs/tests
// only). Modelled as a DomainError subclass so it can be thrown or carried in a Result.
export type NotificationErrorCode = "NotNotificationOwner";

export class NotificationError extends DomainError {
  override readonly name = "NotificationError";

  private constructor(
    readonly code: NotificationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A member tried to act on (e.g. read) a notification that is not addressed to them.
  static notOwner(notificationId: NotificationId, member: MemberId): NotificationError {
    return new NotificationError(
      "NotNotificationOwner",
      `Member ${member} does not own notification ${notificationId}`,
    );
  }
}
