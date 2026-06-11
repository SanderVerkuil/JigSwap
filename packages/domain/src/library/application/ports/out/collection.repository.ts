import { Collection, CollectionId, OwnerId } from "../../../domain";

// Outbound port: persistence for the Collection aggregate. The 2c-convex adapter implements
// this over the `collections` / `collectionMembers` tables behind a mapper.
export interface CollectionRepository {
  findById(id: CollectionId): Promise<Collection | null>;
  save(collection: Collection): Promise<void>;
  remove(id: CollectionId): Promise<void>;
  listByOwner(ownerId: OwnerId): Promise<readonly Collection[]>;
  // Backs the (owner, name) uniqueness rule, mirroring the `by_user_name` index.
  findByOwnerAndName(
    ownerId: OwnerId,
    name: string,
  ): Promise<Collection | null>;
}
