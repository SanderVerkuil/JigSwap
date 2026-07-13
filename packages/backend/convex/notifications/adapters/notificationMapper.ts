import {
  type Channel,
  Notification,
  type NotificationState,
  type NotificationType,
  toMemberId,
  toNotificationId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `notifications` row and the Notification aggregate. Schema shape stops
// here and never ripples into the domain.

// Insert/patch payload for the notification row (minus Convex-managed `_id`/`_creationTime`).
export type NotificationRow = Omit<
  Doc<"notifications">,
  "_id" | "_creationTime"
>;

// Row -> aggregate. Only domain-written/backfilled rows (carrying an aggregateId) are mappable;
// callers guard for it. `channel` defaults to inApp for legacy rows missing it.
export const toDomain = (row: Doc<"notifications">): Notification => {
  const state: NotificationState = {
    id: toNotificationId(row.aggregateId as string),
    userId: toMemberId(row.userId as unknown as string),
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    params: row.params,
    relatedId: row.relatedId,
    channel: (row.channel ?? "inApp") as Channel,
    isRead: row.isRead,
    createdAt: new Date(row.createdAt),
  };
  return Notification.rehydrate(state);
};

// Aggregate -> row payload. `userId` is a user `_id`, carried directly by the domain as a MemberId.
export const toRow = (notification: Notification): NotificationRow => {
  const state: NotificationState = notification.toState();
  return {
    aggregateId: state.id as string,
    userId: state.userId as unknown as Id<"users">,
    type: state.type,
    title: state.title,
    message: state.message,
    params: state.params as Record<string, string> | undefined,
    relatedId: state.relatedId,
    channel: state.channel,
    isRead: state.isRead,
    createdAt: state.createdAt.getTime(),
  };
};
