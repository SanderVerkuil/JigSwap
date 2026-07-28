import { beforeEach, describe, expect, it } from "vitest";
import {
  toCopyId,
  toMemberId,
  toPuzzleDefinitionId,
} from "../../../shared-kernel";

import {
  CopyReviewRepository,
  CopyReviewUpsert,
  PuzzleReviewRepository,
  PuzzleReviewUpsert,
} from "../ports/out/review.repositories";
import { FixedClock, RecordingEventPublisher } from "../testing";
import { makeUpsertCopyReview } from "./upsert-copy-review";
import { makeUpsertPuzzleReview } from "./upsert-puzzle-review";

const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const PUZZLE = toPuzzleDefinitionId("puzzle-1");
const COPY = toCopyId("copy-1");
const NOW = new Date("2026-06-01T11:30:00Z");

// Upsert-only recording fakes: cardinality (one row per member+puzzle / member+copy) is the
// persistence adapter's job, so the fakes just record every call for assertion.
class RecordingPuzzleReviewRepository implements PuzzleReviewRepository {
  readonly upserts: PuzzleReviewUpsert[] = [];
  async upsert(review: PuzzleReviewUpsert): Promise<void> {
    this.upserts.push(review);
  }
}

class RecordingCopyReviewRepository implements CopyReviewRepository {
  readonly upserts: CopyReviewUpsert[] = [];
  async upsert(review: CopyReviewUpsert): Promise<void> {
    this.upserts.push(review);
  }
}

describe("Review upsert use cases", () => {
  let events: RecordingEventPublisher;
  let clock: FixedClock;

  beforeEach(() => {
    events = new RecordingEventPublisher();
    clock = new FixedClock(NOW);
  });

  describe("upsertPuzzleReview", () => {
    let puzzleReviews: RecordingPuzzleReviewRepository;

    beforeEach(() => {
      puzzleReviews = new RecordingPuzzleReviewRepository();
    });

    it("upserts a review and publishes PuzzleReviewUpserted", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleDefinitionId: PUZZLE,
        rating: 4,
        text: "Great fit",
      });
      expect(result.isOk).toBe(true);
      expect(puzzleReviews.upserts).toEqual([
        {
          userId: ALICE,
          puzzleDefinitionId: PUZZLE,
          rating: 4,
          text: "Great fit",
          now: NOW,
        },
      ]);
      expect(events.published).toEqual([
        expect.objectContaining({
          name: "PuzzleReviewUpserted",
          userId: ALICE,
          puzzleDefinitionId: PUZZLE,
          rating: 4,
          occurredAt: NOW,
        }),
      ]);
    });

    it("passes a second review for the same member+puzzle through (upsert semantics)", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const first = await upsert({
        actingMemberId: ALICE,
        puzzleDefinitionId: PUZZLE,
        rating: 4,
      });
      const second = await upsert({
        actingMemberId: ALICE,
        puzzleDefinitionId: PUZZLE,
        rating: 2,
      });
      expect(first.isOk).toBe(true);
      expect(second.isOk).toBe(true);
      expect(puzzleReviews.upserts).toHaveLength(2);
      expect(puzzleReviews.upserts[1]?.rating).toBe(2);
      expect(events.countOf("PuzzleReviewUpserted")).toBe(2);
    });

    it.each([0, 6])("rejects rating %i with InvalidRating", async (rating) => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleDefinitionId: PUZZLE,
        rating,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
      expect(puzzleReviews.upserts).toHaveLength(0);
      expect(events.published).toHaveLength(0);
    });

    it("normalises whitespace-only text to undefined", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleDefinitionId: PUZZLE,
        rating: 3,
        text: "   ",
      });
      expect(result.isOk).toBe(true);
      expect(puzzleReviews.upserts[0]?.text).toBeUndefined();
    });
  });

  describe("upsertCopyReview", () => {
    let copyReviews: RecordingCopyReviewRepository;

    beforeEach(() => {
      copyReviews = new RecordingCopyReviewRepository();
    });

    it("lets the copy owner review and publishes CopyReviewUpserted", async () => {
      const upsert = makeUpsertCopyReview({ copyReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        copyId: COPY,
        copyOwnerId: ALICE,
        hasCompletionOnCopy: false,
        rating: 5,
      });
      expect(result.isOk).toBe(true);
      expect(copyReviews.upserts).toEqual([
        { userId: ALICE, copyId: COPY, rating: 5, now: NOW },
      ]);
      expect(events.published).toEqual([
        expect.objectContaining({
          name: "CopyReviewUpserted",
          userId: ALICE,
          copyId: COPY,
          rating: 5,
          occurredAt: NOW,
        }),
      ]);
    });

    it("lets a member with a completion on the copy review", async () => {
      const upsert = makeUpsertCopyReview({ copyReviews, events, clock });
      const result = await upsert({
        actingMemberId: BOB,
        copyId: COPY,
        copyOwnerId: ALICE,
        hasCompletionOnCopy: true,
        rating: 3,
      });
      expect(result.isOk).toBe(true);
      expect(copyReviews.upserts).toHaveLength(1);
      expect(events.names()).toEqual(["CopyReviewUpserted"]);
    });

    it("rejects a member who neither owns nor completed the copy", async () => {
      const upsert = makeUpsertCopyReview({ copyReviews, events, clock });
      const result = await upsert({
        actingMemberId: BOB,
        copyId: COPY,
        copyOwnerId: ALICE,
        hasCompletionOnCopy: false,
        rating: 3,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotAllowedToReviewCopy");
      }
      expect(copyReviews.upserts).toHaveLength(0);
      expect(events.published).toHaveLength(0);
    });

    it("rejects an invalid rating with InvalidRating", async () => {
      const upsert = makeUpsertCopyReview({ copyReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        copyId: COPY,
        copyOwnerId: ALICE,
        hasCompletionOnCopy: false,
        rating: 0,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
      expect(copyReviews.upserts).toHaveLength(0);
    });
  });
});
