import { ExchangeId, Thread, ThreadId } from "../../domain";
import { ThreadRepository } from "../ports/out/thread.repository";

// In-memory ThreadRepository for use-case tests, keyed by thread id. Stores persisted state and
// rehydrates a fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryThreadRepository implements ThreadRepository {
  private readonly store = new Map<ThreadId, ReturnType<Thread["toState"]>>();

  async findByExchange(exchangeId: ExchangeId): Promise<Thread | null> {
    for (const state of this.store.values()) {
      if (state.exchangeId === exchangeId) {
        return Thread.rehydrate(state);
      }
    }
    return null;
  }

  async findById(threadId: ThreadId): Promise<Thread | null> {
    const state = this.store.get(threadId);
    return state ? Thread.rehydrate(state) : null;
  }

  async save(thread: Thread): Promise<void> {
    this.store.set(thread.id, thread.toState());
  }

  // Test helper: how many threads are currently stored.
  size(): number {
    return this.store.size;
  }
}
