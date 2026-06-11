import { MemberId, Notification, NotificationId } from "../../../domain";

// Outbound port: persistence for the Notification aggregate. The 4a-backend adapter implements
// this over `ctx.db` (the `notifications` table) behind a mapper; the domain never sees a row.
export interface NotificationRepository {
  findById(id: NotificationId): Promise<Notification | null>;
  save(notification: Notification): Promise<void>;
  // All notifications addressed to a member (newest-first ordering is the adapter's concern).
  listByUser(userId: MemberId): Promise<Notification[]>;
  // Bulk-mark every unread notification for a member as read. Returns the affected notifications
  // (already mutated + with events recorded) so the use case can save them and publish their
  // events; an adapter may implement this as a single indexed scan.
  markAllReadForUser(userId: MemberId, now: Date): Promise<Notification[]>;
}
