import type { CollectionDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toCollectionDetailView, toOwnedCopyView } from "./mappers";

// Library read: a collection with its member copies resolved (each carrying its addedAt and joined
// Catalog puzzle). Returns null on a missing collection, and drops members whose copy was deleted —
// both preserved from legacy collections.getCollectionById; the result maps to a typed detail DTO.
export const getCollectionById = query({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args): Promise<CollectionDetailView | null> => {
    const actingMember = (await requireMember(ctx)) as unknown as Id<"users">;

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) return null;

    // Visibility ACL: only the owner may read a non-public collection.
    if (
      collection.userId !== actingMember &&
      collection.visibility !== "public"
    ) {
      return null;
    }

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
