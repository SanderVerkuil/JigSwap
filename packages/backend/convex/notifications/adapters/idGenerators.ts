import {
  type NotificationId,
  type NotificationIdGenerator,
  type NotificationPreferenceId,
  type NotificationPreferenceIdGenerator,
  toNotificationId,
  toNotificationPreferenceId,
} from "@jigswap/domain";

// Driven adapters for the Notifications id-generator ports. crypto.randomUUID is available in the
// Convex runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const notificationIdGenerator: NotificationIdGenerator = {
  next: (): NotificationId => toNotificationId(crypto.randomUUID()),
};

export const notificationPreferenceIdGenerator: NotificationPreferenceIdGenerator =
  {
    next: (): NotificationPreferenceId =>
      toNotificationPreferenceId(crypto.randomUUID()),
  };
