import type {
  CopyReviewRepository,
  PuzzleReviewRepository,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapters for the two-level review model over `ctx.db`. Upsert-by-unique-key: the
// one-row-per-(member, target) cardinality the domain ports promise lives HERE, via the
// `by_user_puzzle`/`by_user_copy` indexes. The branded `PuzzleDefinitionId`/`CopyId` at this
// port CARRY Convex doc `_id`s: composition roots brand `v.id(...)` args / row FK values via
// `toPuzzleDefinitionId`/`toCopyId` (the postPuzzleReview.ts idiom), so the adapters just cast
// back — no resolution. This mirrors the social-context branding, NOT
// convexCompletionRepository (which resolves aggregateIds).

export const convexPuzzleReviewRepository = (
  ctx: MutationCtx,
): PuzzleReviewRepository => ({
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
});
