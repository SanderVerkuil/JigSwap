import {
  type NotificationId,
  type NotificationIdGenerator,
  type NotificationPreferenceId,
  type NotificationPreferenceIdGenerator,
  toId,
} from "@jigswap/domain";

// Driven adapters for the Notifications id-generator ports. crypto.randomUUID is available in the
// Convex runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const notificationIdGenerator: NotificationIdGenerator = {
  next: (): NotificationId => toId<"NotificationId">(crypto.randomUUID()),
};

export const notificationPreferenceIdGenerator: NotificationPreferenceIdGenerator = {
  next: (): NotificationPreferenceId =>
    toId<"NotificationPreferenceId">(crypto.randomUUID()),
};
