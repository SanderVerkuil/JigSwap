import { MemberId, SolvingPreferences } from "../../domain";
import type { SolvingPreferencesRepository } from "../ports/out/solving-preferences.repository";

// In-memory SolvingPreferencesRepository for use-case tests. Stores persisted state and
// rehydrates a fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemorySolvingPreferencesRepository implements SolvingPreferencesRepository {
  private readonly store = new Map<
    MemberId,
    ReturnType<SolvingPreferences["toState"]>
  >();

  async findByMember(memberId: MemberId): Promise<SolvingPreferences | null> {
    const state = this.store.get(memberId);
    return state ? SolvingPreferences.rehydrate(state) : null;
  }

  async save(preferences: SolvingPreferences): Promise<void> {
    this.store.set(preferences.memberId, preferences.toState());
  }
}
