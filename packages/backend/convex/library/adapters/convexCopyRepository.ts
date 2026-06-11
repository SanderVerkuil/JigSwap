import type { Copy, CopyId, CopyRepository, OwnerId } from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./copyMapper";

// Driven adapter for the CopyRepository port over `ctx.db`. The only place `ownedPuzzles` (and
// the Copy's images in `ownedPuzzleImages`) are read/written for the domain path; the mapper is
// the ACL.
export const convexCopyRepository = (ctx: MutationCtx): CopyRepository => {
  const loadImages = (
    ownedPuzzleId: Id<"ownedPuzzles">,
  ): Promise<Doc<"ownedPuzzleImages">[]> =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", ownedPuzzleId))
      .collect();

  const rowById = (id: CopyId): Promise<Doc<"ownedPuzzles"> | null> =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  // Resolve the real `puzzles._id` for the Copy's Catalog reference (a PuzzleDefinitionId
  // aggregateId). The legacy `puzzleId` FK must hold a genuine document id, not the aggregateId.
  const resolvePuzzleId = async (
    puzzleDefinitionId: string,
  ): Promise<Id<"puzzles">> => {
    const byAggregateId = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", puzzleDefinitionId),
      )
      .unique();
    if (byAggregateId) return byAggregateId._id;
    // Fallback: a legacy puzzle that predates aggregateId — the value may be a raw `_id`.
    return puzzleDefinitionId as Id<"puzzles">;
  };

  return {
    async findById(id: CopyId): Promise<Copy | null> {
      const row = await rowById(id);
      if (!row) return null;
      const images = await loadImages(row._id);
      return toDomain(row, images);
    },

    async save(copy: Copy): Promise<void> {
      const mapped = toRow(copy);
      const puzzleId = await resolvePuzzleId(mapped.puzzleDefinitionId!);
      const row = { ...mapped, puzzleId };
      const existing = await rowById(copy.id);
      const ownedPuzzleId = existing
        ? (await ctx.db.patch(existing._id, row), existing._id)
        : await ctx.db.insert("ownedPuzzles", row);

      // Images belong to the Copy; persist any the aggregate carries that aren't stored yet.
      // Keyed by fileId, which is unique per uploaded file, so re-saves don't duplicate rows.
      const persisted = await loadImages(ownedPuzzleId);
      const persistedFileIds = new Set(
        persisted.map((img) => img.fileId as unknown as string),
      );
      const now = Date.now();
      for (const image of copy.toState().images) {
        const fileId = image.fileId as unknown as string;
        if (persistedFileIds.has(fileId)) continue;
        await ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId,
          // The uploader is the owner of the copy (the domain has no separate uploader concept).
          uploaderId: copy.ownerId as unknown as Id<"users">,
          fileId: image.fileId as unknown as Id<"_storage">,
          title: image.title,
          description: image.description,
          tag: image.tag,
          takenAt: image.takenAt?.getTime(),
          createdAt: now,
          updatedAt: now,
        });
      }
    },

    async remove(id: CopyId): Promise<void> {
      // Resolve the real `ownedPuzzles._id` from the aggregateId, then cascade-delete the row and
      // its owned rows (collection memberships + images) so no orphans survive the Copy.
      const row = await rowById(id);
      if (!row) return;

      const memberships = await ctx.db
        .query("collectionMembers")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", row._id))
        .collect();
      for (const membership of memberships) await ctx.db.delete(membership._id);

      const images = await loadImages(row._id);
      for (const image of images) await ctx.db.delete(image._id);

      await ctx.db.delete(row._id);
    },

    async listByOwner(ownerId: OwnerId): Promise<readonly Copy[]> {
      const rows = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) =>
          q.eq("ownerId", ownerId as unknown as Id<"users">),
        )
        .collect();
      // Only domain-written rows (legacy rows lack an aggregateId) participate in the new path.
      const owned = rows.filter((row) => row.aggregateId !== undefined);
      return Promise.all(
        owned.map(async (row) => toDomain(row, await loadImages(row._id))),
      );
    },
  };
};
