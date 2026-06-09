import { Follow, FollowId, MemberId } from "../../domain";
import { FollowRepository } from "../ports/out/follow.repository";

// In-memory FollowRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryFollowRepository implements FollowRepository {
  private readonly store = new Map<FollowId, ReturnType<Follow["toState"]>>();

  async find(
    followerId: MemberId,
    followeeId: MemberId,
  ): Promise<Follow | null> {
    for (const state of this.store.values()) {
      if (state.followerId === followerId && state.followeeId === followeeId) {
        return Follow.rehydrate(state);
      }
    }
    return null;
  }

  async save(follow: Follow): Promise<void> {
    this.store.set(follow.id, follow.toState());
  }

  async remove(follow: Follow): Promise<void> {
    this.store.delete(follow.id);
  }

  async listFollowees(memberId: MemberId): Promise<readonly MemberId[]> {
    const result: MemberId[] = [];
    for (const state of this.store.values()) {
      if (state.followerId === memberId) {
        result.push(state.followeeId);
      }
    }
    return result;
  }

  // Test helper: how many follow edges are currently stored.
  size(): number {
    return this.store.size;
  }
}
