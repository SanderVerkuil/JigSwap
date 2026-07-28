import type { PublicPuzzleReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { projectPublicAuthor } from "./privacy";

// UNAUTHENTICATED read of the community reviews on a catalog definition (the `puzzleReviews`
// table, one row per member), for the public /catalog/$id page. Sibling of listPuzzleReviews (the
// auth-gated member read, which always names authors via toMemberView); this one projects each
// author through projectPublicAuthor instead — named iff their profile is public, null (rendered
// as "A JigSwap member") otherwise.
//
// Leak gate: reviews of a non-approved definition return [] (mirrors every public catalog read).
// Most-recently-updated first: the `by_puzzle` index orders by _creationTime, so rows are sorted
// by `updatedAt` in JS after collect.
export const listPublicPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicPuzzleReviewView[]> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || puzzle.status !== "approved") return [];

    const rows = (
      await ctx.db
        .query("puzzleReviews")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
        .collect()
    ).sort((a, b) => b.updatedAt - a.updatedAt);

    return Promise.all(
      rows.map(async (row): Promise<PublicPuzzleReviewView> => ({
        id: row._id,
        author: await projectPublicAuthor(ctx, row.userId),
        rating: row.rating ?? null,
        text: row.text ?? null,
        updatedAt: row.updatedAt,
      })),
    );
  },
});
