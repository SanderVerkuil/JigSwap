import { MemberId, Notification, NotificationId } from "../../../domain";

// Outbound port: persistence for the Notification aggregate. The 4a-backend adapter implements
// this over `ctx.db` (the `notifications` table) behind a mapper; the domain never sees a row.
export interface NotificationRepository {
  findById(id: NotificationId): Promise<Notification | null>;
  save(notification: Notification): Promise<void>;
  // All notifications addressed to a member (newest-first ordering is the adapter's concern).
  listByUser(userId: MemberId): Promise<Notification[]>;
  // Bulk-mark a member's unread notifications as read. Returns the affected notifications
  // (already mutated + with events recorded) so the use case can save them and publish their
  // events; an adapter may implement this as a single indexed scan, and may bound one call to a
  // batch, leaving the driving adapter to call again while unread notifications remain.
  markAllReadForUser(userId: MemberId, now: Date): Promise<Notification[]>;
}
