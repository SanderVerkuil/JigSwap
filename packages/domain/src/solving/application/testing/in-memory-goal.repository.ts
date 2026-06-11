import { Goal, GoalId, MemberId } from "../../domain";
import { GoalRepository } from "../ports/out/goal.repository";

// In-memory GoalRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryGoalRepository implements GoalRepository {
  private readonly store = new Map<GoalId, ReturnType<Goal["toState"]>>();

  async findById(id: GoalId): Promise<Goal | null> {
    const state = this.store.get(id);
    return state ? Goal.rehydrate(state) : null;
  }

  async save(goal: Goal): Promise<void> {
    this.store.set(goal.id, goal.toState());
  }

  async listByUser(userId: MemberId): Promise<readonly Goal[]> {
    return [...this.store.values()]
      .filter((state) => state.userId === userId)
      .map((state) => Goal.rehydrate(state));
  }

  size(): number {
    return this.store.size;
  }
}
