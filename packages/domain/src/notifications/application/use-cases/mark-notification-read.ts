import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { NotificationError } from "../../domain";
import { NotificationApplicationError } from "../errors";
import {
  MarkNotificationRead,
  MarkNotificationReadCommand,
} from "../ports/in/mark-notification-read.port";
import { NotificationRepository } from "../ports/out/notification.repository";

export interface MarkNotificationReadDeps {
  readonly notifications: NotificationRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Load the notification, delegate the ownership + idempotency rules to the aggregate, then save
// and publish. A missing notification is an application error; a wrong owner is a domain error.
export const makeMarkNotificationRead =
  (deps: MarkNotificationReadDeps): MarkNotificationRead =>
  async (
    cmd: MarkNotificationReadCommand,
  ): Promise<Result<void, NotificationError | NotificationApplicationError>> => {
    const notification = await deps.notifications.findById(cmd.notificationId);
    if (!notification) {
      return err(NotificationApplicationError.notificationNotFound(cmd.notificationId));
    }

    const marked = notification.markRead(cmd.memberId, deps.clock.now());
    if (marked.isErr) return err(marked.error);

    await deps.notifications.save(notification);
    await deps.events.publish(notification.pullEvents());
    return ok(undefined);
  };
