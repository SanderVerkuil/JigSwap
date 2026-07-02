import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Catalog write: flip the acting member's favorite on a puzzle DEFINITION. The member is derived
// from auth, never the client. Favoriting when already favorited never duplicates (all existing
// rows for the pair are removed on unfavorite, so a stray duplicate self-heals). Returns the new
// state so the client can reconcile its optimistic toggle.
export const toggleFavorite = mutation({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<{ favorited: boolean }> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) throw new ConvexError("Puzzle not found");

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", memberId).eq("puzzleId", args.puzzleId),
      )
      .collect();

    if (existing.length > 0) {
      await Promise.all(existing.map((row) => ctx.db.delete(row._id)));
      return { favorited: false };
    }

    await ctx.db.insert("favorites", {
      userId: memberId,
      puzzleId: args.puzzleId,
      createdAt: Date.now(),
    });
    return { favorited: true };
  },
});
