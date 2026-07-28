import type {
  CopyId,
  CopyReviewRepository,
  PuzzleDefinitionId,
  PuzzleReviewRepository,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapters for the two-level review model over `ctx.db`. Upsert-by-unique-key: the
// one-row-per-(member, target) cardinality the domain ports promise lives HERE, via the
// `by_user_puzzle`/`by_user_copy` indexes. The domain hands branded aggregateId strings; the
// FK columns are `v.id(...)`, so the adapters resolve real document ids at the boundary
// (mirroring convexCompletionRepository; legacy rows fall back to treating the value as a
// raw `_id`).

// Resolve the real `puzzles._id` for a Catalog PuzzleDefinitionId aggregateId.
const resolvePuzzleId = async (
  ctx: MutationCtx,
  puzzleDefinitionId: PuzzleDefinitionId,
): Promise<Id<"puzzles">> => {
  const byAggregateId = await ctx.db
    .query("puzzles")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", puzzleDefinitionId as string),
    )
    .unique();
  return byAggregateId
    ? byAggregateId._id
    : (puzzleDefinitionId as unknown as Id<"puzzles">);
};

// Resolve the real `ownedPuzzles._id` for a Library CopyId aggregateId.
const resolveCopyId = async (
  ctx: MutationCtx,
  copyId: CopyId,
): Promise<Id<"ownedPuzzles">> => {
  const byAggregateId = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId as string))
    .unique();
  return byAggregateId
    ? byAggregateId._id
    : (copyId as unknown as Id<"ownedPuzzles">);
};

export const convexPuzzleReviewRepository = (
  ctx: MutationCtx,
): PuzzleReviewRepository => ({
  async upsert(review): Promise<void> {
    const userId = review.userId as unknown as Id<"users">;
    const puzzleId = await resolvePuzzleId(ctx, review.puzzleId);
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
    const copyId = await resolveCopyId(ctx, review.copyId);
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
