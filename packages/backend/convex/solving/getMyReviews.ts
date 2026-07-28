import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// The caller's OWN reviews for the two-level review form, plus whether they may review the copy
// (owner or completion-holder). Deliberately leaks nothing about the copy itself — other
// members' reviews and copy content never cross this boundary, only the boolean.
export const getMyReviews = query({
  args: {
    puzzleId: v.id("puzzles"),
    copyId: v.optional(v.id("ownedPuzzles")),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    const puzzleRow = await ctx.db
      .query("puzzleReviews")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", userId).eq("puzzleId", args.puzzleId),
      )
      .unique();

    let copyRow = null;
    let copyReviewAllowed = false;
    if (args.copyId !== undefined) {
      const copyId = args.copyId;
      copyRow = await ctx.db
        .query("copyReviews")
        .withIndex("by_user_copy", (q) =>
          q.eq("userId", userId).eq("copyId", copyId),
        )
        .unique();

      const copy = await ctx.db.get(copyId);
      if (copy) {
        const isOwner = copy.ownerId === userId;
        const hasCompletionOnCopy =
          (await ctx.db
            .query("completions")
            .withIndex("by_user_owned_puzzle", (q) =>
              q.eq("userId", userId).eq("ownedPuzzleId", copyId),
            )
            .first()) !== null;
        copyReviewAllowed = isOwner || hasCompletionOnCopy;
      }
    }

    return {
      puzzle: puzzleRow
        ? { rating: puzzleRow.rating ?? null, text: puzzleRow.text ?? null }
        : null,
      copy: copyRow ? { rating: copyRow.rating } : null,
      copyReviewAllowed,
    };
  },
});
