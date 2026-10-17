import {
  Notification,
  toMemberId,
  toNotificationId,
  type Channel,
  type NotificationState,
  type NotificationSubject,
  type NotificationType,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `notifications` row and the Notification aggregate. Schema shape stops
// here and never ripples into the domain.

// Insert/patch payload for the notification row (minus Convex-managed `_id`/`_creationTime`).
export type NotificationRow = Omit<
  Doc<"notifications">,
  "_id" | "_creationTime"
>;

// The persisted subject: the domain's opaque string ids, with puzzle/copy/goal typed as Convex ids.
type SubjectRow = NonNullable<Doc<"notifications">["subject"]>;

// Row -> aggregate. Only domain-written/backfilled rows (carrying an aggregateId) are mappable;
// callers guard for it. `channel` defaults to inApp for legacy rows missing it. The aggregate holds
// one actor: the newest of `actorIds` (legacy rows carry none).
export const toDomain = (row: Doc<"notifications">): Notification => {
  const state: NotificationState = {
    id: toNotificationId(row.aggregateId as string),
    userId: toMemberId(row.userId as unknown as string),
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    params: row.params,
    relatedId: row.relatedId,
    actorId:
      row.actorIds?.[0] !== undefined
        ? toMemberId(row.actorIds[0] as unknown as string)
        : undefined,
    subject: row.subject as NotificationSubject | undefined,
    channel: (row.channel ?? "inApp") as Channel,
    isRead: row.isRead,
    createdAt: new Date(row.createdAt),
  };
  return Notification.rehydrate(state);
};

// Aggregate -> row payload. `userId` is a user `_id`, carried directly by the domain as a MemberId.
// The actor/subject keys are only written when present, so a re-save (markRead patch) of a row
// without refs leaves it shaped exactly as before.
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
    ...(state.actorId !== undefined
      ? {
          actorIds: [state.actorId as unknown as Id<"users">],
          actorCount: 1,
        }
      : {}),
    ...(state.subject !== undefined
      ? { subject: state.subject as SubjectRow }
      : {}),
    channel: state.channel,
    isRead: state.isRead,
    createdAt: state.createdAt.getTime(),
  };
};
