import type { OwnedCopyView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toOwnedCopyView } from "./mappers";

// Library read: a member's owned copies (optionally only the available ones), each joined to its
// Catalog puzzle. Filtering (availability), the newest-first ordering, and the join are preserved
// from legacy puzzles.getOwnedPuzzlesByOwner; rows map to typed copy DTOs.
export const getOwnedPuzzlesByOwner = query({
  args: {
    ownerId: v.id("users"),
    includeUnavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<OwnedCopyView[]> => {
    let ownedPuzzles = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    if (!args.includeUnavailable) {
      ownedPuzzles = ownedPuzzles.filter(
        (i) =>
          i.availability.forTrade ||
          i.availability.forSale ||
          i.availability.forLend,
      );
    }

    const views = await Promise.all(
      ownedPuzzles.map(async (copy) =>
        toOwnedCopyView(copy, await ctx.db.get(copy.puzzleId)),
      ),
    );

    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});
