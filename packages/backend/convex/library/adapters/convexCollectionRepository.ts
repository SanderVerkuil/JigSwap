import {
  Collection,
  type CollectionId,
  type CollectionRepository,
  type CollectionState,
  type CopyId,
  type OwnerId,
  type PuzzleDefinitionId,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for the CollectionRepository port. Maps the `collections` row + its
// `collectionMembers` rows to/from the Collection aggregate. The aggregate's copy members are
// CopyIds (aggregateIds); `collectionMembers.ownedPuzzleId` is the Convex _id of the copy row,
// so this adapter translates between the two via the copy's `aggregateId`.
export const convexCollectionRepository = (
  ctx: MutationCtx,
): CollectionRepository => {
  const rowById = (id: CollectionId): Promise<Doc<"collections"> | null> =>
    ctx.db
      .query("collections")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  const membersOf = (collectionRowId: Id<"collections">) =>
    ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) => q.eq("collectionId", collectionRowId))
      .collect();

  // Resolve a member row's `ownedPuzzleId` (_id) to the copy's domain CopyId (aggregateId).
  const copyIdOf = async (
    ownedPuzzleId: Id<"ownedPuzzles">,
  ): Promise<CopyId | null> => {
    const copy = await ctx.db.get(ownedPuzzleId);
    return copy?.aggregateId
      ? (toId<"CopyId">(copy.aggregateId) as CopyId)
      : null;
  };

  // Resolve a domain CopyId (aggregateId) to the copy row's Convex _id for membership writes.
  const ownedPuzzleIdOf = async (
    copyId: CopyId,
  ): Promise<Id<"ownedPuzzles"> | null> => {
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", copyId as string),
      )
      .unique();
    return copy ? copy._id : null;
  };

  const toDomain = async (row: Doc<"collections">): Promise<Collection> => {
    const memberRows = await membersOf(row._id);
    const copyMembers: CopyId[] = [];
    for (const member of memberRows) {
      const copyId = await copyIdOf(member.ownedPuzzleId);
      if (copyId) copyMembers.push(copyId);
    }
    const state: CollectionState = {
      id: toId<"CollectionId">(row.aggregateId as string),
      ownerId: toId<"OwnerId">(row.userId as unknown as string) as OwnerId,
      name: row.name,
      description: row.description,
      visibility: row.visibility,
      color: row.color,
      icon: row.icon,
      isDefault: row.isDefault,
      isWishlist: row.isWishlist ?? false,
      personalNotes: row.personalNotes,
      copyMembers,
      wishedDefinitions: (row.wishedDefinitions ?? []).map(
        (id) => toId<"PuzzleDefinitionId">(id) as PuzzleDefinitionId,
      ),
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
    return Collection.rehydrate(state);
  };

  return {
    async findById(id: CollectionId): Promise<Collection | null> {
      const row = await rowById(id);
      return row ? toDomain(row) : null;
    },

    async save(collection: Collection): Promise<void> {
      const state = collection.toState();
      const rowPayload = {
        aggregateId: state.id as string,
        userId: state.ownerId as unknown as Id<"users">,
        name: state.name,
        description: state.description,
        visibility: state.visibility,
        color: state.color,
        icon: state.icon,
        isDefault: state.isDefault,
        isWishlist: state.isWishlist,
        wishedDefinitions: state.wishedDefinitions.map((id) => id as string),
        personalNotes: state.personalNotes,
        createdAt: state.createdAt.getTime(),
        updatedAt: state.updatedAt.getTime(),
      };
      const existing = await rowById(collection.id);
      const collectionRowId = existing
        ? (await ctx.db.patch(existing._id, rowPayload), existing._id)
        : await ctx.db.insert("collections", rowPayload);

      // Reconcile membership rows against the aggregate's copy members. Resolve each CopyId to
      // its copy row _id; drop removed members, insert added ones.
      const desired = new Map<string, Id<"ownedPuzzles">>();
      for (const copyId of state.copyMembers) {
        const ownedPuzzleId = await ownedPuzzleIdOf(copyId);
        if (ownedPuzzleId) desired.set(ownedPuzzleId, ownedPuzzleId);
      }
      const memberRows = await membersOf(collectionRowId);
      const present = new Set(
        memberRows.map((m) => m.ownedPuzzleId as unknown as string),
      );
      for (const member of memberRows) {
        if (!desired.has(member.ownedPuzzleId as unknown as string)) {
          await ctx.db.delete(member._id);
        }
      }
      const now = Date.now();
      for (const ownedPuzzleId of desired.values()) {
        if (present.has(ownedPuzzleId as unknown as string)) continue;
        await ctx.db.insert("collectionMembers", {
          collectionId: collectionRowId,
          ownedPuzzleId,
          addedAt: now,
        });
      }
    },

    async remove(id: CollectionId): Promise<void> {
      const row = await rowById(id);
      if (!row) return;
      const memberRows = await membersOf(row._id);
      for (const member of memberRows) await ctx.db.delete(member._id);
      await ctx.db.delete(row._id);
    },

    async listByOwner(ownerId: OwnerId): Promise<readonly Collection[]> {
      const rows = await ctx.db
        .query("collections")
        .withIndex("by_user", (q) =>
          q.eq("userId", ownerId as unknown as Id<"users">),
        )
        .collect();
      const owned = rows.filter((row) => row.aggregateId !== undefined);
      return Promise.all(owned.map((row) => toDomain(row)));
    },

    async findByOwnerAndName(
      ownerId: OwnerId,
      name: string,
    ): Promise<Collection | null> {
      const row = await ctx.db
        .query("collections")
        .withIndex("by_user_name", (q) =>
          q.eq("userId", ownerId as unknown as Id<"users">).eq("name", name),
        )
        .first();
      return row ? toDomain(row) : null;
    },
  };
};
