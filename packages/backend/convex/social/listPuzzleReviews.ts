import type { PuzzleCommentView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";

// Read side: the community reviews on a catalog puzzle DEFINITION, keyed by puzzleId directly (the
// catalog detail page has no copyId). Newest first. Each review joins its REAL author (reviews are
// voluntary public posts — never anonymised); the author join falls back to a synthetic "Member"
// view if the user row vanished, so an orphaned review never breaks the list. Mirrors
// listPuzzleComments, which keys by copyId.
//
// SECURITY: auth-gated. Each review is projected through `toMemberView`, which exposes member
// identity (name/username/bio/location) intended only for OTHER AUTHENTICATED MEMBERS — so the
// handler requires a signed-in member before returning any author view. There is no copy here (these
// are catalog-definition reviews with copyId == null), so the `canViewCopy` reachability gate that
// listPuzzleComments uses does NOT apply; auth is the correct gate for definition-level reviews.
export const listPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleCommentView[]> => {
    await requireMember(ctx);

    const rows = (
      await ctx.db
        .query("puzzleComments")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
        .order("desc")
        .collect()
    ).filter((row) => row.copyId == null); // community reviews only; exclude copy-scoped comments

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
