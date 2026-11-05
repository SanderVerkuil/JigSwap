import {
  toMemberId,
  type CopyReviewRepository,
  type PuzzleReviewRepository,
  type ReviewedDefinition,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

// Driven adapters for the two-level review model over `ctx.db`. Upsert-by-unique-key: the
// one-row-per-(member, target) cardinality the domain ports promise lives HERE, via the
// `by_user_puzzle`/`by_user_copy` indexes. The branded `PuzzleDefinitionId`/`CopyId` at this
// port CARRY Convex doc `_id`s: composition roots brand `v.id(...)` args / row FK values via
// `toPuzzleDefinitionId`/`toCopyId` (the postPuzzleReview.ts idiom), so the adapters just cast
// back — no resolution. This mirrors the social-context branding, NOT
// convexCompletionRepository (which resolves aggregateIds). `remove` deletes the member's own
// puzzle or copy review row (the author's delete, SEC-70).

// The facts makeUpsertPuzzleReview checks before a puzzle review (null: no such puzzle). Read
// once per review by the composition roots (social/postPuzzleReview, solving/submitReviews).
export const reviewedDefinitionOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<ReviewedDefinition | null> => {
  const puzzle = await ctx.db.get(puzzleId);
  if (!puzzle) return null;
  return {
    isApproved: puzzle.status === "approved",
    submitterId: toMemberId(puzzle.submittedBy as unknown as string),
  };
};

export const convexPuzzleReviewRepository = (
  ctx: MutationCtx,
): PuzzleReviewRepository => ({
  async storedText(memberId, puzzleDefinitionId): Promise<string | undefined> {
    const userId = memberId as unknown as Id<"users">;
    const puzzleId = puzzleDefinitionId as unknown as Id<"puzzles">;
    const existing = await ctx.db
      .query("puzzleReviews")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", userId).eq("puzzleId", puzzleId),
      )
      .unique();
    return existing?.text;
  },
  async upsert(review): Promise<void> {
    const userId = review.userId as unknown as Id<"users">;
    const puzzleId = review.puzzleId as unknown as Id<"puzzles">;
    const now = review.now.getTime();
    const existing = await ctx.db
      .query("puzzleReviews")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", userId).eq("puzzleId", puzzleId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: review.rating,
        text: review.text,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.insert("puzzleReviews", {
      userId,
      puzzleId,
      rating: review.rating,
      text: review.text,
      createdAt: now,
      updatedAt: now,
    });
  },

  async remove(memberId, definitionId): Promise<boolean> {
    const userId = memberId as unknown as Id<"users">;
    const puzzleId = definitionId as unknown as Id<"puzzles">;
    const existing = await ctx.db
      .query("puzzleReviews")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", userId).eq("puzzleId", puzzleId),
      )
      .unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const convexCopyReviewRepository = (
  ctx: MutationCtx,
): CopyReviewRepository => ({
  async upsert(review): Promise<void> {
    const userId = review.userId as unknown as Id<"users">;
    const copyId = review.copyId as unknown as Id<"ownedPuzzles">;
    const now = review.now.getTime();
    const existing = await ctx.db
      .query("copyReviews")
      .withIndex("by_user_copy", (q) =>
        q.eq("userId", userId).eq("copyId", copyId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: review.rating,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.insert("copyReviews", {
      userId,
      copyId,
      rating: review.rating,
      createdAt: now,
      updatedAt: now,
    });
  },

  async remove(memberId, copyRef): Promise<boolean> {
    const userId = memberId as unknown as Id<"users">;
    const copyId = copyRef as unknown as Id<"ownedPuzzles">;
    const existing = await ctx.db
      .query("copyReviews")
      .withIndex("by_user_copy", (q) =>
        q.eq("userId", userId).eq("copyId", copyId),
      )
      .unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});
