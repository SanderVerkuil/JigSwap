import { MemberId, ReputationProfile } from "../../domain";
import { ReputationProfileRepository } from "../ports/out/reputation-profile.repository";

// In-memory ReputationProfileRepository for use-case tests, keyed by member. Stores persisted
// state and rehydrates a fresh aggregate on read.
export class InMemoryReputationProfileRepository
  implements ReputationProfileRepository
{
  private readonly store = new Map<
    MemberId,
    ReturnType<ReputationProfile["toState"]>
  >();

  async findByMember(memberId: MemberId): Promise<ReputationProfile | null> {
    const state = this.store.get(memberId);
    return state ? ReputationProfile.rehydrate(state) : null;
  }

  async save(profile: ReputationProfile): Promise<void> {
    this.store.set(profile.memberId, profile.toState());
  }

  // Test helper: how many profiles are currently stored.
  size(): number {
    return this.store.size;
  }
}
