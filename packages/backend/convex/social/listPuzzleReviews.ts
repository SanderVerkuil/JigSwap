import type { PuzzleReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";

// Read side: the community reviews on a catalog puzzle DEFINITION — the `puzzleReviews` table, one
// row per (member, puzzle), keyed by puzzleId directly (the catalog detail page has no copyId).
// Most-recently-updated first: the `by_puzzle` index orders by _creationTime, so rows are sorted by
// `updatedAt` in JS after collect. Each review joins its REAL author (reviews are voluntary public
// posts — never anonymised); the author join falls back to a synthetic "Member" view if the user
// row vanished, so an orphaned review never breaks the list.
//
// SECURITY: auth-gated. Each review is projected through `toMemberView`, which exposes member
// identity (name/username/bio/location) intended only for OTHER AUTHENTICATED MEMBERS — so the
// handler requires a signed-in member before returning any author view. There is no copy here
// (these are catalog-definition reviews), so the `canViewCopy` reachability gate that
// listPuzzleComments uses does NOT apply; auth is the correct gate for definition-level reviews.
export const listPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleReviewView[]> => {
    await requireMember(ctx);

    const rows = (
      await ctx.db
        .query("puzzleReviews")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
        .collect()
    ).sort((a, b) => b.updatedAt - a.updatedAt);

    return Promise.all(
      rows.map(async (row): Promise<PuzzleReviewView> => {
        const author = await ctx.db.get(row.userId);
        return {
          id: row._id,
          author: author
            ? toMemberView(author)
            : {
                _id: row.userId,
                _creationTime: 0,
                name: "Member",
                isActive: false,
                createdAt: 0,
                updatedAt: 0,
              },
          rating: row.rating ?? null,
          text: row.text ?? null,
          updatedAt: row.updatedAt,
        };
      }),
    );
  },
});
