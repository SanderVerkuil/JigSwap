import { FollowRequest, FollowRequestId, MemberId } from "../../domain";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";

// In-memory FollowRequestRepository for use-case tests. Stores persisted state and rehydrates a
// fresh aggregate on read, mirroring the round-trip a real adapter performs. findByPair scans,
// matching the adapter's index semantics (one live row per pair).
export class InMemoryFollowRequestRepository implements FollowRequestRepository {
  private readonly store = new Map<
    FollowRequestId,
    ReturnType<FollowRequest["toState"]>
  >();

  async findByPair(
    requesterId: MemberId,
    targetId: MemberId,
  ): Promise<FollowRequest | null> {
    for (const state of this.store.values()) {
      if (state.requesterId === requesterId && state.targetId === targetId) {
        return FollowRequest.rehydrate(state);
      }
    }
    return null;
  }

  async findById(id: FollowRequestId): Promise<FollowRequest | null> {
    const state = this.store.get(id);
    return state ? FollowRequest.rehydrate(state) : null;
  }

  async save(request: FollowRequest): Promise<void> {
    this.store.set(request.id, request.toState());
  }

  async remove(request: FollowRequest): Promise<void> {
    this.store.delete(request.id);
  }

  // Test helper: how many follow requests are currently stored.
  size(): number {
    return this.store.size;
  }
}
