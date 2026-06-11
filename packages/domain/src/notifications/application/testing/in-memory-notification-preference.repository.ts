import { MemberId, NotificationPreference } from "../../domain";
import { NotificationPreferenceRepository } from "../ports/out/notification-preference.repository";

// In-memory NotificationPreferenceRepository for use-case tests. Keyed by member, mirroring the
// per-member row the real adapter maps to; rehydrates a fresh aggregate on read.
export class InMemoryNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private readonly store = new Map<
    MemberId,
    ReturnType<NotificationPreference["toState"]>
  >();

  async findByMember(
    memberId: MemberId,
  ): Promise<NotificationPreference | null> {
    const state = this.store.get(memberId);
    return state ? NotificationPreference.rehydrate(state) : null;
  }

  async save(preference: NotificationPreference): Promise<void> {
    this.store.set(preference.memberId, preference.toState());
  }

  // Test helper: how many preference sets are currently stored.
  size(): number {
    return this.store.size;
  }
}
