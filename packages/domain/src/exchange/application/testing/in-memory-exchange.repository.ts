import { CopyId, Exchange, ExchangeId, MemberId } from "../../domain";
import { ExchangeRepository } from "../ports/out/exchange.repository";

// In-memory ExchangeRepository for use-case tests. Stores persisted state and rehydrates a
// fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryExchangeRepository implements ExchangeRepository {
  private readonly store = new Map<ExchangeId, ReturnType<Exchange["toState"]>>();

  async findById(id: ExchangeId): Promise<Exchange | null> {
    const state = this.store.get(id);
    return state ? Exchange.rehydrate(state) : null;
  }

  async save(exchange: Exchange): Promise<void> {
    this.store.set(exchange.id, exchange.toState());
  }

  async findActiveProposal(
    initiatorId: MemberId,
    requestedCopyId: CopyId,
  ): Promise<Exchange | null> {
    for (const state of this.store.values()) {
      if (
        state.status === "proposed" &&
        state.initiatorId === initiatorId &&
        state.requestedCopyId === requestedCopyId
      ) {
        return Exchange.rehydrate(state);
      }
    }
    return null;
  }

  // Test helper: how many exchanges are currently stored.
  size(): number {
    return this.store.size;
  }
}
