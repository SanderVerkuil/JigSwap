import type { CollectionDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toCollectionDetailView, toOwnedCopyView } from "./mappers";

// Library read: a collection with its member copies resolved (each carrying its addedAt and joined
// Catalog puzzle). Returns null on a missing collection, and drops members whose copy was deleted —
// both preserved from legacy collections.getCollectionById; the result maps to a typed detail DTO.
export const getCollectionById = query({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args): Promise<CollectionDetailView | null> => {
    const collection = await ctx.db.get(args.collectionId);
    if (!collection) return null;

    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) =>
        q.eq("collectionId", args.collectionId),
      )
      .collect();

    const puzzles = await Promise.all(
      members.map(async (member) => {
        const copy = member.ownedPuzzleId
          ? await ctx.db.get(member.ownedPuzzleId)
          : null;
        if (!copy) return null;
        const puzzle = await ctx.db.get(copy.puzzleId);
        return toOwnedCopyView(copy, puzzle, { addedAt: member.addedAt });
      }),
    );

    return toCollectionDetailView(
      collection,
      puzzles.filter((p) => p !== null),
    );
  },
});
