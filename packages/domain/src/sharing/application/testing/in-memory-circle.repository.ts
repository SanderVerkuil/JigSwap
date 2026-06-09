import { Circle, CircleId, MemberId } from "../../domain";
import { CircleRepository } from "../ports/out/circle.repository";

// In-memory CircleRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryCircleRepository implements CircleRepository {
  private readonly store = new Map<CircleId, ReturnType<Circle["toState"]>>();

  async findById(id: CircleId): Promise<Circle | null> {
    const state = this.store.get(id);
    return state ? Circle.rehydrate(state) : null;
  }

  async listForMember(memberId: MemberId): Promise<readonly Circle[]> {
    return [...this.store.values()]
      .filter((state) => state.memberships.some((m) => m.memberId === memberId))
      .map((state) => Circle.rehydrate(state));
  }

  async save(circle: Circle): Promise<void> {
    this.store.set(circle.id, circle.toState());
  }

  // Test helper: how many circles are currently stored.
  size(): number {
    return this.store.size;
  }
}
