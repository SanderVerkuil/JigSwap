import { Copy, CopyId, OwnerId } from "../../domain";
import { CopyRepository } from "../ports/out/copy.repository";

// In-memory CopyRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryCopyRepository implements CopyRepository {
  private readonly store = new Map<CopyId, ReturnType<Copy["toState"]>>();

  async findById(id: CopyId): Promise<Copy | null> {
    const state = this.store.get(id);
    return state ? Copy.rehydrate(state) : null;
  }

  async save(copy: Copy): Promise<void> {
    this.store.set(copy.id, copy.toState());
  }

  async remove(id: CopyId): Promise<void> {
    this.store.delete(id);
  }

  async listByOwner(ownerId: OwnerId): Promise<readonly Copy[]> {
    return [...this.store.values()]
      .filter((state) => state.ownerId === ownerId)
      .map((state) => Copy.rehydrate(state));
  }

  size(): number {
    return this.store.size;
  }
}
