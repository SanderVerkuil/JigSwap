import type { PublicPuzzleReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { droppedForBlock, viewerBlocksOf, type ViewerBlocks } from "./blocks";
import { projectMemberIdentity, projectPublicAuthor } from "./privacy";

// UNAUTHENTICATED read of the community reviews on a catalog definition (the `puzzleReviews`
// table, one row per member), for the public /catalog/$id page. Sibling of listPuzzleReviews (the
// auth-gated member read, which projects authors per viewer via projectMemberIdentity); this one
// projects each author through projectPublicAuthor instead — named iff their profile is public,
// null (rendered as "A JigSwap member") otherwise.
//
// Leak gate: reviews of a non-approved definition return [] (mirrors every public catalog read).
// Most-recently-updated first: the `by_puzzle` index orders by _creationTime, so rows are sorted
// by `updatedAt` in JS after collect.
export const listPublicPuzzleReviews = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PublicPuzzleReviewView[]> => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle || puzzle.status !== "approved") return [];
    // Signed in: authors who blocked the viewer drop out (spec 2.6), and so do authors the viewer
    // blocked when the in-app chokepoint names them to the viewer (as on listPuzzleReviews). One
    // the viewer blocked but can't see stays, so a block never confirms who wrote it (SEC-40).
    const viewerId = await optionalActingMember(ctx);
    const blocks: ViewerBlocks = viewerId
      ? await viewerBlocksOf(ctx, viewerId)
      : { byMe: new Set(), byThem: new Set() };

    const all = await ctx.db
      .query("puzzleReviews")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
      .collect();
    const revealedToViewer = async (authorId: Id<"users">) =>
      viewerId !== null &&
      !(
        await projectMemberIdentity(
          ctx,
          viewerId,
          authorId,
          args.puzzleId as string,
        )
      ).anonymous;
    const rows = [];
    for (const row of all) {
      // Only an author the viewer blocked needs the reveal decision.
      const revealed =
        blocks.byMe.has(row.userId) && (await revealedToViewer(row.userId));
      if (!droppedForBlock(blocks, row.userId, revealed)) rows.push(row);
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt);

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
