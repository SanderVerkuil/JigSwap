import { beforeEach, describe, expect, it } from "vitest";
import { toCompletionId, toFileId, toMemberId } from "../../../shared-kernel";

import { EDIT_WINDOW_MS } from "../../domain/completion";
import {
  FixedClock,
  InMemoryCompletionRepository,
  RecordingEventPublisher,
  SequentialCompletionIdGenerator,
} from "../testing";
import { makeEditCompletion } from "./edit-completion";
import { makeFinishCompletion } from "./finish-completion";
import { makeRecordCompletion } from "./record-completion";
import { makeReviewPuzzle } from "./review-puzzle";
import { makeStartCompletion } from "./start-completion";

const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const START = new Date("2026-06-01T10:00:00Z");
const END = new Date("2026-06-01T11:30:00Z");
const NOW = new Date("2026-06-01T11:30:00Z");

describe("Completion use cases", () => {
  let completions: InMemoryCompletionRepository;
  let events: RecordingEventPublisher;
  let ids: SequentialCompletionIdGenerator;
  let clock: FixedClock;

  beforeEach(() => {
    completions = new InMemoryCompletionRepository();
    events = new RecordingEventPublisher();
    ids = new SequentialCompletionIdGenerator();
    clock = new FixedClock(NOW);
  });

  describe("startCompletion", () => {
    it("persists an in-progress completion and publishes CompletionStarted", async () => {
      const start = makeStartCompletion({ completions, ids, events, clock });
      const result = await start({ userId: ALICE, startDate: START });
      expect(result.isOk).toBe(true);
      expect(completions.size()).toBe(1);
      expect(events.names()).toEqual(["CompletionStarted"]);
    });

    it("propagates the photo-cap error", async () => {
      const start = makeStartCompletion({ completions, ids, events, clock });
      const result = await start({
        userId: ALICE,
        startDate: START,
        photoFileIds: Array.from({ length: 6 }, (_, i) => toFileId(`f-${i}`)),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("TooManyPhotos");
      expect(events.published).toHaveLength(0);
    });

    it("maps photo file ids onto the started completion", async () => {
      const start = makeStartCompletion({ completions, ids, events, clock });
      const result = await start({
        userId: ALICE,
        startDate: START,
        photoFileIds: [toFileId("p-1"), toFileId("p-2")],
      });
      expect(result.isOk).toBe(true);
      if (!result.isOk) return;
      const stored = await completions.findById(result.value);
      expect(stored?.photos.map((p) => p.fileId)).toEqual([
        toFileId("p-1"),
        toFileId("p-2"),
      ]);
    });
  });

  describe("recordCompletion", () => {
    it("persists a finished completion and publishes CompletionRecorded", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const result = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CompletionRecorded"]);
    });

    it("attaches a review and publishes PuzzleReviewed when a rating is supplied", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const result = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
        rating: 5,
        reviewText: "great",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CompletionRecorded", "PuzzleReviewed"]);
    });

    it("rejects an invalid rating with InvalidRating", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const result = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
        rating: 9,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
    });

    it("rejects an end before start with InvalidTimeRange", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const result = await record({
        userId: ALICE,
        startDate: END,
        endDate: START,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidTimeRange");
    });

    it("maps photo file ids onto the recorded completion", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const result = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
        photoFileIds: [toFileId("p-1")],
      });
      expect(result.isOk).toBe(true);
      if (!result.isOk) return;
      const stored = await completions.findById(result.value);
      expect(stored?.photos.map((p) => p.fileId)).toEqual([toFileId("p-1")]);
    });
  });

  describe("finishCompletion", () => {
    it("finishes an in-progress completion owned by the member", async () => {
      const start = makeStartCompletion({ completions, ids, events, clock });
      const started = await start({ userId: ALICE, startDate: START });
      if (!started.isOk) throw new Error("setup failed");

      const finish = makeFinishCompletion({ completions, events, clock });
      const result = await finish({
        actingMemberId: ALICE,
        completionId: started.value,
        endDate: END,
      });
      expect(result.isOk).toBe(true);
      expect(events.countOf("CompletionRecorded")).toBe(1);
    });

    it("returns CompletionNotFound for an unknown id", async () => {
      const finish = makeFinishCompletion({ completions, events, clock });
      const result = await finish({
        actingMemberId: ALICE,
        completionId: toCompletionId("nope"),
        endDate: END,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CompletionNotFound");
    });

    it("rejects a non-owner with NotCompletionOwner", async () => {
      const start = makeStartCompletion({ completions, ids, events, clock });
      const started = await start({ userId: ALICE, startDate: START });
      if (!started.isOk) throw new Error("setup failed");

      const finish = makeFinishCompletion({ completions, events, clock });
      const result = await finish({
        actingMemberId: BOB,
        completionId: started.value,
        endDate: END,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCompletionOwner");
    });

    it("propagates an invalid-time-range error from finish", async () => {
      const start = makeStartCompletion({ completions, ids, events, clock });
      const started = await start({ userId: ALICE, startDate: START });
      if (!started.isOk) throw new Error("setup failed");

      const finish = makeFinishCompletion({ completions, events, clock });
      const result = await finish({
        actingMemberId: ALICE,
        completionId: started.value,
        endDate: new Date("2026-06-01T09:00:00Z"), // before start
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidTimeRange");
    });
  });

  describe("editCompletion", () => {
    const seedRecorded = async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const recorded = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
      });
      if (!recorded.isOk) throw new Error("setup failed");
      events.published.length = 0;
      return recorded.value;
    };

    it("edits within the 24h window and publishes CompletionEdited", async () => {
      const id = await seedRecorded();
      clock.set(new Date(END.getTime() + EDIT_WINDOW_MS - 1));
      const edit = makeEditCompletion({ completions, events, clock });
      const result = await edit({
        actingMemberId: ALICE,
        completionId: id,
        notes: "tweaked",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CompletionEdited"]);
      const stored = await completions.findById(id);
      expect(stored?.toState().notes).toBe("tweaked"); // the change actually lands
    });

    it("returns CompletionNotFound for an unknown id", async () => {
      const edit = makeEditCompletion({ completions, events, clock });
      const result = await edit({
        actingMemberId: ALICE,
        completionId: toCompletionId("nope"),
        notes: "x",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CompletionNotFound");
    });

    it("maps edited photo file ids onto the completion", async () => {
      const id = await seedRecorded();
      clock.set(new Date(END.getTime() + EDIT_WINDOW_MS - 1));
      const edit = makeEditCompletion({ completions, events, clock });
      const result = await edit({
        actingMemberId: ALICE,
        completionId: id,
        photoFileIds: [toFileId("e-1"), toFileId("e-2")],
      });
      expect(result.isOk).toBe(true);
      const stored = await completions.findById(id);
      expect(stored?.photos.map((p) => p.fileId)).toEqual([
        toFileId("e-1"),
        toFileId("e-2"),
      ]);
    });

    it("rejects an edit after the window with EditWindowClosed", async () => {
      const id = await seedRecorded();
      clock.set(new Date(END.getTime() + EDIT_WINDOW_MS + 1));
      const edit = makeEditCompletion({ completions, events, clock });
      const result = await edit({
        actingMemberId: ALICE,
        completionId: id,
        notes: "late",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("EditWindowClosed");
    });

    it("rejects a non-owner with NotCompletionOwner", async () => {
      const id = await seedRecorded();
      const edit = makeEditCompletion({ completions, events, clock });
      const result = await edit({
        actingMemberId: BOB,
        completionId: id,
        notes: "x",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCompletionOwner");
    });
  });

  describe("reviewPuzzle", () => {
    it("attaches a review to the member's completion", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const recorded = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
      });
      if (!recorded.isOk) throw new Error("setup failed");
      events.published.length = 0;

      const review = makeReviewPuzzle({ completions, events, clock });
      const result = await review({
        actingMemberId: ALICE,
        completionId: recorded.value,
        rating: 4,
        text: "nice",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["PuzzleReviewed"]);

      const stored = await completions.findById(recorded.value);
      expect(stored?.puzzleReview?.rating.value).toBe(4);
      expect(stored?.puzzleReview?.text).toBe("nice");
    });

    it("rejects an invalid rating with InvalidRating", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const recorded = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
      });
      if (!recorded.isOk) throw new Error("setup failed");

      const review = makeReviewPuzzle({ completions, events, clock });
      const result = await review({
        actingMemberId: ALICE,
        completionId: recorded.value,
        rating: 0,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
    });

    it("returns CompletionNotFound for an unknown id", async () => {
      const review = makeReviewPuzzle({ completions, events, clock });
      const result = await review({
        actingMemberId: ALICE,
        completionId: toCompletionId("nope"),
        rating: 4,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CompletionNotFound");
    });

    it("rejects a non-owner with NotCompletionOwner", async () => {
      const record = makeRecordCompletion({ completions, ids, events, clock });
      const recorded = await record({
        userId: ALICE,
        startDate: START,
        endDate: END,
      });
      if (!recorded.isOk) throw new Error("setup failed");

      const review = makeReviewPuzzle({ completions, events, clock });
      const result = await review({
        actingMemberId: BOB,
        completionId: recorded.value,
        rating: 4,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCompletionOwner");
    });
  });
});
