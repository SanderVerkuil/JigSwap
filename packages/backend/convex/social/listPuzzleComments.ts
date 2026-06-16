import type { PuzzleCommentView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";

// Read side: the COPY-scoped comments on the given owned copy (the owner's own notes/rating),
// newest first — NOT the shared community reviews (those live on the catalog page via
// listPuzzleReviews). Each comment joins its REAL author (comments are voluntary public posts —
// never anonymised). A missing copy returns []. The author join falls back to a synthetic "Member"
// view if the user row vanished, so an orphaned comment never breaks the list.
export const listPuzzleComments = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<PuzzleCommentView[]> => {
    const copy = await ctx.db.get(args.copyId);
    if (!copy) return [];

    const rows = await ctx.db
      .query("puzzleComments")
      .withIndex("by_copy", (q) => q.eq("copyId", args.copyId))
      .order("desc")
      .collect();

    return Promise.all(
      rows.map(async (row): Promise<PuzzleCommentView> => {
        const author = await ctx.db.get(row.authorId);
        return {
          id: row.aggregateId ?? row._id,
          author: author
            ? toMemberView(author)
            : {
                _id: row.authorId,
                _creationTime: 0,
                name: "Member",
                isActive: false,
                createdAt: 0,
                updatedAt: 0,
              },
          text: row.text,
          rating: row.rating ?? null,
          createdAt: row.createdAt,
        };
      }),
    );
  },
});
