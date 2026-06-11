import { MemberId, Notification, NotificationId } from "../../domain";
import { NotificationRepository } from "../ports/out/notification.repository";

// In-memory NotificationRepository for use-case tests. Stores persisted state and rehydrates a
// fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly store = new Map<
    NotificationId,
    ReturnType<Notification["toState"]>
  >();

  async findById(id: NotificationId): Promise<Notification | null> {
    const state = this.store.get(id);
    return state ? Notification.rehydrate(state) : null;
  }

  async save(notification: Notification): Promise<void> {
    this.store.set(notification.id, notification.toState());
  }

  async listByUser(userId: MemberId): Promise<Notification[]> {
    const result: Notification[] = [];
    for (const state of this.store.values()) {
      if (state.userId === userId) {
        result.push(Notification.rehydrate(state));
      }
    }
    return result;
  }

  async markAllReadForUser(
    userId: MemberId,
    now: Date,
  ): Promise<Notification[]> {
    const affected: Notification[] = [];
    for (const state of this.store.values()) {
      if (state.userId === userId && !state.isRead) {
        const notification = Notification.rehydrate(state);
        const marked = notification.markRead(userId, now);
        if (marked.isOk) {
          this.store.set(notification.id, notification.toState());
          affected.push(notification);
        }
      }
    }
    return affected;
  }

  // Test helper: how many notifications are currently stored.
  size(): number {
    return this.store.size;
  }
}
