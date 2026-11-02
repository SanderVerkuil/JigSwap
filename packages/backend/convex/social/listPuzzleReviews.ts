import type { PuzzleReviewView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { canViewDefinition } from "../catalog/definitionVisibility";
import { requireMember } from "../identity/requireMember";
import { clampPaginationOpts } from "../lib/pageSize";
import schema from "../schema";
import { droppedForBlock, viewerBlocksOf } from "./blocks";
import { projectMemberIdentity } from "./privacy";

// A page holds 1 to MAX_REVIEW_PAGE_SIZE reviews whatever the client asks for.
export const MAX_REVIEW_PAGE_SIZE = 50;

// Read side: the community reviews on a catalog puzzle DEFINITION — the `puzzleReviews` table, one
// row per (member, puzzle), keyed by puzzleId directly (the catalog detail page has no copyId).
// Most-recently-updated first, a page at a time (by_puzzle_updated). `canDelete` marks the viewer's
// own review: only the author may delete it (social/deletePuzzleReview, SEC-70).
//
// SECURITY (SEC-11):
//   - Auth-gated, and the definition must be disclosed to the caller exactly as getPuzzleById
//     discloses it (canViewDefinition: APPROVED, or the caller is its submitter, or an admin). A
//     hidden or missing definition returns an empty page, so its reviews never reveal that it
//     exists.
//   - Each author goes through the privacy chokepoint (projectMemberIdentity, salt = the puzzle
//     id): a private author the viewer is not connected with is anonymous, a circle mate sees
//     identity only, and a departed author is anonymous + `departed` (the web's "Deleted
//     member"). Bio, location and language never reach a viewer the ordinary rules don't reveal.
//   - Authors who blocked the viewer drop out (spec 2.6), and so do authors the viewer blocked
//     when the viewer can see who they are. An author the viewer blocked but can't see keeps
//     their anonymous entry unchanged, so a block never confirms who wrote it (SEC-40).
// There is no copy here (these are catalog-definition reviews), so the `canViewCopy` reachability
// gate that listPuzzleComments uses does NOT apply.
export const listPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || !(await canViewDefinition(ctx, puzzle, viewerId))) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const blocks = await viewerBlocksOf(ctx, viewerId);
    const project = (authorId: Id<"users">) =>
      projectMemberIdentity(ctx, viewerId, authorId, args.puzzleId as string);

    // The block rules run while the page fills, so it stays full. Only an author the viewer blocked
    // needs the identity decision here; one review per member, so every author is projected once
    // more below at most.
    const result = await stream(ctx.db, schema)
      .query("puzzleReviews")
      .withIndex("by_puzzle_updated", (q) => q.eq("puzzleId", args.puzzleId))
      .order("desc")
      .filterWith(async (row) => {
        if (blocks.byThem.has(row.userId)) return false;
        if (!blocks.byMe.has(row.userId)) return true;
        return !droppedForBlock(
          blocks,
          row.userId,
          !(await project(row.userId)).anonymous,
        );
      })
      .paginate(clampPaginationOpts(args.paginationOpts, MAX_REVIEW_PAGE_SIZE));

    const page = await Promise.all(
      result.page.map(
        async (row) =>
          ({
            id: row._id,
            author: await project(row.userId),
            rating: row.rating ?? null,
            text: row.text ?? null,
            updatedAt: row.updatedAt,
            canDelete: row.userId === viewerId,
          }) satisfies PuzzleReviewView,
      ),
    );
    return { ...result, page };
  },
});
