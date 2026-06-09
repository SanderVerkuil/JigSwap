import { Collection, CollectionId, OwnerId } from "../../domain";
import { CollectionRepository } from "../ports/out/collection.repository";

// In-memory CollectionRepository for use-case tests, including the (owner, name) lookup that
// backs the uniqueness rule.
export class InMemoryCollectionRepository implements CollectionRepository {
  private readonly store = new Map<
    CollectionId,
    ReturnType<Collection["toState"]>
  >();

  async findById(id: CollectionId): Promise<Collection | null> {
    const state = this.store.get(id);
    return state ? Collection.rehydrate(state) : null;
  }

  async save(collection: Collection): Promise<void> {
    this.store.set(collection.id, collection.toState());
  }

  async remove(id: CollectionId): Promise<void> {
    this.store.delete(id);
  }

  async listByOwner(ownerId: OwnerId): Promise<readonly Collection[]> {
    return [...this.store.values()]
      .filter((state) => state.ownerId === ownerId)
      .map((state) => Collection.rehydrate(state));
  }

  async findByOwnerAndName(
    ownerId: OwnerId,
    name: string,
  ): Promise<Collection | null> {
    for (const state of this.store.values()) {
      if (state.ownerId === ownerId && state.name === name) {
        return Collection.rehydrate(state);
      }
    }
    return null;
  }

  size(): number {
    return this.store.size;
  }
}
