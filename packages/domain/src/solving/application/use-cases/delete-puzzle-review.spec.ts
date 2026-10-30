import { describe, expect, it } from "vitest";
import { toMemberId, toPuzzleDefinitionId } from "../../../shared-kernel";
import { MemberId, PuzzleDefinitionId } from "../../domain";
import {
  PuzzleReviewRepository,
  PuzzleReviewUpsert,
} from "../ports/out/review.repositories";
import { makeDeletePuzzleReview } from "./delete-puzzle-review";

const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const PUZZLE = toPuzzleDefinitionId("puzzle-1");
const OTHER_PUZZLE = toPuzzleDefinitionId("puzzle-2");
const NOW = new Date("2026-10-30T10:00:00Z");

// One row per (member, puzzle), as the persistence adapter keeps it.
class InMemoryPuzzleReviews implements PuzzleReviewRepository {
  readonly rows = new Map<string, PuzzleReviewUpsert>();
  private key = (userId: MemberId, puzzleId: PuzzleDefinitionId) =>
    `${userId}/${puzzleId}`;
  async upsert(review: PuzzleReviewUpsert): Promise<void> {
    this.rows.set(this.key(review.userId, review.puzzleId), review);
  }
  async storedText(
    userId: MemberId,
    puzzleId: PuzzleDefinitionId,
  ): Promise<string | undefined> {
    return this.rows.get(this.key(userId, puzzleId))?.text;
  }
  async remove(
    userId: MemberId,
    puzzleId: PuzzleDefinitionId,
  ): Promise<boolean> {
    return this.rows.delete(this.key(userId, puzzleId));
  }
}

const seeded = async () => {
  const puzzleReviews = new InMemoryPuzzleReviews();
  await puzzleReviews.upsert({
    userId: ALICE,
    puzzleId: PUZZLE,
    rating: 4,
    text: "Lovely cut",
    now: NOW,
  });
  await puzzleReviews.upsert({
    userId: BOB,
    puzzleId: PUZZLE,
    rating: 2,
    now: NOW,
  });
  await puzzleReviews.upsert({
    userId: ALICE,
    puzzleId: OTHER_PUZZLE,
    rating: 5,
    now: NOW,
  });
  return puzzleReviews;
};

describe("makeDeletePuzzleReview", () => {
  it("removes only the acting member's review of that puzzle", async () => {
    const puzzleReviews = await seeded();
    const deleteReview = makeDeletePuzzleReview({ puzzleReviews });

    const result = await deleteReview({
      actingMemberId: ALICE,
      puzzleId: PUZZLE,
    });

    expect(result.isOk).toBe(true);
    expect([...puzzleReviews.rows.keys()].sort()).toEqual([
      "alice/puzzle-2",
      "bob/puzzle-1",
    ]);
  });

  it("answers PuzzleReviewNotFound when the member has no review of the puzzle", async () => {
    const puzzleReviews = await seeded();
    const deleteReview = makeDeletePuzzleReview({ puzzleReviews });

    const result = await deleteReview({
      actingMemberId: BOB,
      puzzleId: OTHER_PUZZLE,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("PuzzleReviewNotFound");
    expect(puzzleReviews.rows.size).toBe(3);
  });
});
