import { Channel, Notification } from "../../../domain";

// Outbound delivery seam (proposal §1.4 / Phase 4): the use case hands each allowed channel its
// Notification and lets the adapter decide what "delivery" means per channel — in-app PERSISTS,
// email/push dispatch out-of-band. This is the port that keeps the use case ignorant of whether a
// channel is a database row or a future SMTP/push send.
export interface NotificationDelivery {
  deliver(channel: Channel, notification: Notification): Promise<void>;
}
