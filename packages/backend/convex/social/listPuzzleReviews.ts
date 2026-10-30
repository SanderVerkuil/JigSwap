import type { PuzzleReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "./blocks";
import { projectMemberIdentity } from "./privacy";

// Read side: the community reviews on a catalog puzzle DEFINITION — the `puzzleReviews` table, one
// row per (member, puzzle), keyed by puzzleId directly (the catalog detail page has no copyId).
// Most-recently-updated first: the `by_puzzle` index orders by _creationTime, so rows are sorted by
// `updatedAt` in JS after collect.
//
// SECURITY (SEC-11):
//   - Auth-gated, and the definition must be disclosed to the caller exactly as getPuzzleById
//     discloses it: APPROVED, or the caller is its submitter, or an admin. Otherwise [].
//   - Each author goes through the privacy chokepoint (projectMemberIdentity, salt = the puzzle
//     id): a private author the viewer is not connected with is anonymous, a circle mate sees
//     identity only, and a departed author is anonymous + `departed` (the web's "Deleted
//     member"). Bio, location and language never reach a viewer the ordinary rules don't reveal.
//   - Authors blocked either way with the viewer drop out (spec 2.6).
// There is no copy here (these are catalog-definition reviews), so the `canViewCopy` reachability
// gate that listPuzzleComments uses does NOT apply.
export const listPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleReviewView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) return [];
    if (
      puzzle.status !== "approved" &&
      puzzle.submittedBy !== viewerId &&
      !(await isAdmin(ctx))
    ) {
      return [];
    }
    const blockedIds = await blockedEitherWaySet(ctx, viewerId);

    const rows = (
      await ctx.db
        .query("puzzleReviews")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
        .collect()
    )
      .filter((row) => !blockedIds.has(row.userId))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    // One review per member, so every author is projected once.
    return Promise.all(
      rows.map(async (row): Promise<PuzzleReviewView> => ({
        id: row._id,
        author: await projectMemberIdentity(
          ctx,
          viewerId,
          row.userId,
          args.puzzleId as string,
        ),
        rating: row.rating ?? null,
        text: row.text ?? null,
        updatedAt: row.updatedAt,
      })),
    );
  },
});
