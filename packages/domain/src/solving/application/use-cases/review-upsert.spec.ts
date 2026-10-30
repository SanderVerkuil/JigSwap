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
import {
  makeUpsertPuzzleReview,
  mayReviewDefinition,
  REVIEW_TEXT_MAX_LENGTH,
} from "./upsert-puzzle-review";

const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const PUZZLE = toPuzzleDefinitionId("puzzle-1");
const COPY = toCopyId("copy-1");
const NOW = new Date("2026-06-01T11:30:00Z");
// An approved definition someone else submitted: anyone may review it.
const APPROVED = { isApproved: true, submitterId: BOB } as const;

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

    it("upserts a review (text trimmed before store) and publishes PuzzleReviewUpserted", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: APPROVED,
        rating: 4,
        text: "  Great fit  ",
      });
      expect(result.isOk).toBe(true);
      expect(puzzleReviews.upserts).toEqual([
        {
          userId: ALICE,
          puzzleId: PUZZLE,
          rating: 4,
          text: "Great fit",
          now: NOW,
        },
      ]);
      expect(events.published).toEqual([
        expect.objectContaining({
          name: "PuzzleReviewUpserted",
          userId: ALICE,
          puzzleId: PUZZLE,
          rating: 4,
          occurredAt: NOW,
        }),
      ]);
    });

    it("passes a second review for the same member+puzzle through (upsert semantics)", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const first = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: APPROVED,
        rating: 4,
      });
      const second = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: APPROVED,
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
        puzzleId: PUZZLE,
        definition: APPROVED,
        rating,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
      expect(puzzleReviews.upserts).toHaveLength(0);
      expect(events.published).toHaveLength(0);
    });

    it("accepts text of exactly the maximum length (measured after trimming)", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: APPROVED,
        rating: 3,
        text: `  ${"a".repeat(REVIEW_TEXT_MAX_LENGTH)}  `,
      });
      expect(result.isOk).toBe(true);
      expect(puzzleReviews.upserts[0]?.text).toHaveLength(
        REVIEW_TEXT_MAX_LENGTH,
      );
    });

    it("rejects text longer than the maximum with ReviewTextTooLong", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: APPROVED,
        rating: 3,
        text: "a".repeat(REVIEW_TEXT_MAX_LENGTH + 1),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("ReviewTextTooLong");
      expect(puzzleReviews.upserts).toHaveLength(0);
      expect(events.published).toHaveLength(0);
    });

    it("caps review text at 2000 characters", () => {
      expect(REVIEW_TEXT_MAX_LENGTH).toBe(2000);
    });

    it("normalises whitespace-only text to undefined", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: APPROVED,
        rating: 3,
        text: "   ",
      });
      expect(result.isOk).toBe(true);
      expect(puzzleReviews.upserts[0]?.text).toBeUndefined();
    });
  });

  describe("upsertPuzzleReview reviewability", () => {
    let puzzleReviews: RecordingPuzzleReviewRepository;

    beforeEach(() => {
      puzzleReviews = new RecordingPuzzleReviewRepository();
    });

    it("rejects a definition that does not exist with PuzzleNotReviewable", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: null,
        rating: 4,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("PuzzleNotReviewable");
      expect(puzzleReviews.upserts).toHaveLength(0);
      expect(events.published).toHaveLength(0);
    });

    it("rejects someone else's unapproved definition with PuzzleNotReviewable", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: { isApproved: false, submitterId: BOB },
        rating: 1,
        text: "on a pending definition",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("PuzzleNotReviewable");
      expect(puzzleReviews.upserts).toHaveLength(0);
      expect(events.published).toHaveLength(0);
    });

    it("mayReviewDefinition: approved for anyone, unapproved for its submitter only", () => {
      expect(mayReviewDefinition(ALICE, APPROVED)).toBe(true);
      expect(
        mayReviewDefinition(ALICE, { isApproved: false, submitterId: ALICE }),
      ).toBe(true);
      expect(
        mayReviewDefinition(ALICE, { isApproved: false, submitterId: BOB }),
      ).toBe(false);
      expect(mayReviewDefinition(ALICE, null)).toBe(false);
    });

    it("lets the submitter review their own unapproved definition", async () => {
      const upsert = makeUpsertPuzzleReview({ puzzleReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        puzzleId: PUZZLE,
        definition: { isApproved: false, submitterId: ALICE },
        rating: 5,
      });
      expect(result.isOk).toBe(true);
      expect(puzzleReviews.upserts).toHaveLength(1);
      expect(events.names()).toEqual(["PuzzleReviewUpserted"]);
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

    it.each([0, 6])("rejects rating %i with InvalidRating", async (rating) => {
      const upsert = makeUpsertCopyReview({ copyReviews, events, clock });
      const result = await upsert({
        actingMemberId: ALICE,
        copyId: COPY,
        copyOwnerId: ALICE,
        hasCompletionOnCopy: false,
        rating,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
      expect(copyReviews.upserts).toHaveLength(0);
    });
  });
});
