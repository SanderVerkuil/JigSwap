import { Completion, CompletionId, MemberId } from "../../domain";
import { CompletionRepository } from "../ports/out/completion.repository";

// In-memory CompletionRepository for use-case tests. Stores persisted state and rehydrates a
// fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryCompletionRepository implements CompletionRepository {
  private readonly store = new Map<
    CompletionId,
    ReturnType<Completion["toState"]>
  >();

  async findById(id: CompletionId): Promise<Completion | null> {
    const state = this.store.get(id);
    return state ? Completion.rehydrate(state) : null;
  }

  async save(completion: Completion): Promise<void> {
    this.store.set(completion.id, completion.toState());
  }

  async listByUser(userId: MemberId): Promise<readonly Completion[]> {
    return [...this.store.values()]
      .filter((state) => state.userId === userId)
      .map((state) => Completion.rehydrate(state));
  }

  async countCompletedByUser(userId: MemberId): Promise<number> {
    return [...this.store.values()].filter(
      (state) => state.userId === userId && state.isCompleted,
    ).length;
  }

  async delete(id: CompletionId): Promise<void> {
    this.store.delete(id);
  }

  size(): number {
    return this.store.size;
  }
}
