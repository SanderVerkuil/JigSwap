import { MemberId, Profile } from "../../domain";
import { ProfileRepository } from "../ports/out/profile.repository";

// In-memory ProfileRepository for use-case tests, keyed by member. Stores persisted state and
// rehydrates a fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryProfileRepository implements ProfileRepository {
  private readonly store = new Map<MemberId, ReturnType<Profile["toState"]>>();

  async findByMember(memberId: MemberId): Promise<Profile | null> {
    const state = this.store.get(memberId);
    return state ? Profile.rehydrate(state) : null;
  }

  async save(profile: Profile): Promise<void> {
    this.store.set(profile.memberId, profile.toState());
  }

  // Test helper: how many profiles are currently stored.
  size(): number {
    return this.store.size;
  }
}
