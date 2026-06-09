import { Result } from "../../../../shared-kernel";
import { MemberId, NotificationError, NotificationId } from "../../../domain";
import { NotificationApplicationError } from "../../errors";

// The command to mark one notification read. `memberId` is resolved from auth by the transport
// adapter and is checked against the notification's addressee (ownership).
export interface MarkNotificationReadCommand {
  readonly memberId: MemberId;
  readonly notificationId: NotificationId;
}

// Inbound port: the mark-notification-read use case.
export interface MarkNotificationRead {
  (
    cmd: MarkNotificationReadCommand,
  ): Promise<Result<void, NotificationError | NotificationApplicationError>>;
}
