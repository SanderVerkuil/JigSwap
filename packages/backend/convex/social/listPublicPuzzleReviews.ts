import type { PublicPuzzleReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { projectPublicAuthor } from "./privacy";

// UNAUTHENTICATED read of the community reviews on a catalog definition, for the public
// /catalog/$id page. Sibling of listPuzzleReviews (the auth-gated member read, which always names
// authors via toMemberView); this one projects each author through projectPublicAuthor instead —
// named iff their profile is public, null (rendered as "A JigSwap member") otherwise.
//
// Leak gates: reviews of a non-approved definition return [] (mirrors every public catalog read),
// and copy-scoped comments (copyId set) are excluded — community reviews only. Newest first.
export const listPublicPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicPuzzleReviewView[]> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || puzzle.status !== "approved") return [];

    const rows = (
      await ctx.db
        .query("puzzleComments")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
        .order("desc")
        .collect()
    ).filter((row) => row.copyId == null);

    return Promise.all(
      rows.map(async (row): Promise<PublicPuzzleReviewView> => ({
        id: row.aggregateId ?? row._id,
        author: await projectPublicAuthor(ctx, row.authorId),
        text: row.text,
        rating: row.rating ?? null,
        createdAt: row.createdAt,
      })),
    );
  },
});
