import { Channel, Notification } from "../../domain";
import { NotificationDelivery } from "../ports/out/notification-delivery.port";
import { InMemoryNotificationRepository } from "./in-memory-notification.repository";

// Recording fake of the delivery seam for use-case tests. It records every (channel, notification)
// pair so a test can assert WHICH channels were delivered, and mirrors the real in-app adapter by
// persisting in-app deliveries into the in-memory repository — so read-based assertions (size,
// listByUser) keep working exactly as when the use case owned persistence.
export class RecordingNotificationDelivery implements NotificationDelivery {
  readonly delivered: Array<{ channel: Channel; notification: Notification }> =
    [];

  constructor(private readonly notifications: InMemoryNotificationRepository) {}

  async deliver(channel: Channel, notification: Notification): Promise<void> {
    this.delivered.push({ channel, notification });
    if (channel === "inApp") await this.notifications.save(notification);
  }

  // Test helper: channels delivered, in delivery order.
  channels(): Channel[] {
    return this.delivered.map((d) => d.channel);
  }
}
