import type { PublicPuzzleReviewView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { paginateBounded } from "../lib/pageSize";
import schema from "../schema";
import { droppedForBlock, viewerBlocksOf, type ViewerBlocks } from "./blocks";
import { MAX_REVIEW_PAGE_SIZE } from "./listPuzzleReviews";
import { projectMemberIdentity, projectPublicAuthor } from "./privacy";

// UNAUTHENTICATED read of the community reviews on a catalog definition (the `puzzleReviews`
// table, one row per member), for the public /catalog/$id page. Sibling of listPuzzleReviews (the
// auth-gated member read, which projects authors per viewer via projectMemberIdentity); this one
// projects each author through projectPublicAuthor instead — named iff their profile is public,
// null (rendered as "A JigSwap member") otherwise.
//
// Leak gate: reviews of a non-approved definition return an empty page (mirrors every public catalog
// read). Most-recently-updated first, a page at a time (by_puzzle_updated).
export const listPublicPuzzleReviewsPage = query({
  args: { puzzleId: v.id("puzzles"), paginationOpts: paginationOptsValidator },
  handler: (ctx, args) =>
    readPublicReviewsPage(ctx, args.puzzleId, args.paginationOpts),
});

// Kept for web builds from before the review lists paged: they ask with just the puzzle and expect an
// array, and would otherwise read "No reviews yet" until they reload. The newest page, through the
// same gates. This build no longer calls it. Remove once those have aged out.
export const listPublicPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicPuzzleReviewView[]> =>
    (
      await readPublicReviewsPage(ctx, args.puzzleId, {
        numItems: MAX_REVIEW_PAGE_SIZE,
        cursor: null,
      })
    ).page,
});

const readPublicReviewsPage = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
  paginationOpts: PaginationOptions,
) => {
  const puzzle = await ctx.db.get(puzzleId);
  if (!puzzle || puzzle.status !== "approved") {
    return { page: [], isDone: true, continueCursor: "" };
  }
  // Signed in: authors who blocked the viewer drop out (spec 2.6), and so do authors the viewer
  // blocked when the in-app chokepoint names them to the viewer (as on listPuzzleReviews). One
  // the viewer blocked but can't see stays, so a block never confirms who wrote it (SEC-40).
  const viewerId = await optionalActingMember(ctx);
  const blocks: ViewerBlocks = viewerId
    ? await viewerBlocksOf(ctx, viewerId)
    : { byMe: new Set(), byThem: new Set() };
  const revealedToViewer = async (authorId: Id<"users">) =>
    viewerId !== null &&
    !(await projectMemberIdentity(ctx, viewerId, authorId, puzzleId as string))
      .anonymous;

  // The block rules run while the page fills, so it stays full.
  const result = await paginateBounded(
    stream(ctx.db, schema)
      .query("puzzleReviews")
      .withIndex("by_puzzle_updated", (q) => q.eq("puzzleId", puzzleId))
      .order("desc")
      .filterWith(async (row) => {
        // Only an author the viewer blocked needs the reveal decision.
        const revealed =
          blocks.byMe.has(row.userId) && (await revealedToViewer(row.userId));
        return !droppedForBlock(blocks, row.userId, revealed);
      }),
    paginationOpts,
    MAX_REVIEW_PAGE_SIZE,
  );

  const page = await Promise.all(
    result.page.map(async (row): Promise<PublicPuzzleReviewView> => ({
      id: row._id,
      author: await projectPublicAuthor(ctx, row.userId),
      rating: row.rating ?? null,
      text: row.text ?? null,
      updatedAt: row.updatedAt,
    })),
  );
  return { ...result, page };
};
