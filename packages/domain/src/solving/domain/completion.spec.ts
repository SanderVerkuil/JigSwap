import { describe, expect, it } from "vitest";
import { toCompletionId, toFileId, toMemberId } from "../../shared-kernel";
import { Completion, EDIT_WINDOW_MS } from "./completion";

import { Photo } from "./photo";
import { PuzzleReview } from "./puzzle-review";
import { StarRating } from "./star-rating";

const ID = toCompletionId("completion-1");
const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const START = new Date("2026-06-01T10:00:00Z");
const END = new Date("2026-06-01T11:30:00Z");
const NOW = new Date("2026-06-01T11:30:00Z");

const photos = (n: number): Photo[] =>
  Array.from({ length: n }, (_, i) => Photo.of(toFileId(`file-${i}`)));

const recordValid = (
  overrides: Partial<Parameters<typeof Completion.record>[0]> = {},
) =>
  Completion.record({
    id: ID,
    userId: ALICE,
    startDate: START,
    endDate: END,
    now: NOW,
    ...overrides,
  });

const names = (c: Completion) => c.pullEvents().map((e) => e.name);

describe("Completion.start", () => {
  it("starts an in-progress completion and records CompletionStarted", () => {
    const result = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.isCompleted).toBe(false);
    expect(names(result.value)).toEqual(["CompletionStarted"]);
  });

  it("rejects more than five photos", () => {
    const result = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      photos: photos(6),
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("TooManyPhotos");
  });

  it("allows exactly five photos", () => {
    const result = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      photos: photos(5),
      now: NOW,
    });
    expect(result.isOk).toBe(true);
  });
});

describe("Completion.record", () => {
  it("records a finished completion and derives the duration", () => {
    const result = recordValid();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.isCompleted).toBe(true);
    expect(result.value.toState().completionTimeMinutes).toBe(90);
    expect(names(result.value)).toEqual(["CompletionRecorded"]);
  });

  it("rejects an end before start with InvalidTimeRange", () => {
    const result = recordValid({ endDate: new Date("2026-06-01T09:00:00Z") });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidTimeRange");
  });

  it("rejects equal start/end as InvalidDuration", () => {
    const result = recordValid({ endDate: START });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
  });

  it("honours an explicit completionTimeMinutes over the span", () => {
    const result = recordValid({ completionTimeMinutes: 45 });
    expect(result.isOk).toBe(true);
    if (result.isOk)
      expect(result.value.toState().completionTimeMinutes).toBe(45);
  });

  it("rejects more than five photos", () => {
    const result = recordValid({ photos: photos(6) });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("TooManyPhotos");
  });

  it("records PuzzleReviewed when a review is supplied", () => {
    const result = recordValid({
      review: PuzzleReview.create(StarRating.fromState(5), "great"),
    });
    expect(result.isOk).toBe(true);
    if (result.isOk)
      expect(names(result.value)).toEqual([
        "CompletionRecorded",
        "PuzzleReviewed",
      ]);
  });
});

describe("Completion.finish", () => {
  it("finishes an in-progress completion and records CompletionRecorded", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    if (!started.isOk) throw new Error("setup failed");
    started.value.pullEvents();

    const outcome = started.value.finish(END, END);
    expect(outcome.isOk).toBe(true);
    expect(started.value.isCompleted).toBe(true);
    expect(started.value.toState().completionTimeMinutes).toBe(90);
    expect(names(started.value)).toEqual(["CompletionRecorded"]);
  });

  it("is a no-op when already completed (no double CompletionRecorded)", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    recorded.value.pullEvents();

    const outcome = recorded.value.finish(END, END);
    expect(outcome.isOk).toBe(true);
    expect(names(recorded.value)).toEqual([]);
  });

  it("rejects an end before start", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    if (!started.isOk) throw new Error("setup failed");
    const outcome = started.value.finish(new Date("2026-06-01T09:00:00Z"), NOW);
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("InvalidTimeRange");
  });
});

describe("Completion.edit", () => {
  it("rejects an edit by a non-owner with NotCompletionOwner", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(BOB, { notes: "x" }, END);
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("NotCompletionOwner");
  });

  it("allows an edit within the 24h window", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    recorded.value.pullEvents();
    const within = new Date(END.getTime() + EDIT_WINDOW_MS - 1);
    const outcome = recorded.value.edit(ALICE, { notes: "tweaked" }, within);
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.toState().notes).toBe("tweaked");
    expect(names(recorded.value)).toEqual(["CompletionEdited"]);
  });

  it("rejects an edit after the 24h window with EditWindowClosed", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const after = new Date(END.getTime() + EDIT_WINDOW_MS + 1);
    const outcome = recorded.value.edit(ALICE, { notes: "late" }, after);
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("EditWindowClosed");
  });

  it("allows editing an in-progress completion regardless of elapsed time", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    if (!started.isOk) throw new Error("setup failed");
    started.value.pullEvents();
    const muchLater = new Date(START.getTime() + EDIT_WINDOW_MS * 10);
    const outcome = started.value.edit(
      ALICE,
      { notes: "still going" },
      muchLater,
    );
    expect(outcome.isOk).toBe(true);
  });

  it("rejects an edit that pushes photos over five", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(ALICE, { photos: photos(6) }, END);
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("TooManyPhotos");
  });

  it("rejects an edit that makes end precede start", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(
      ALICE,
      { endDate: new Date("2026-06-01T09:00:00Z") },
      END,
    );
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("InvalidTimeRange");
  });

  it("recomputes duration when the dates change", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(
      ALICE,
      { endDate: new Date("2026-06-01T10:30:00Z") },
      END,
    );
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.toState().completionTimeMinutes).toBe(30);
  });
});

describe("Completion.review", () => {
  it("attaches a PuzzleReview with rating and text and records PuzzleReviewed", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    recorded.value.pullEvents();
    const outcome = recorded.value.review(
      StarRating.fromState(4),
      END,
      "solid",
    );
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.puzzleReview?.rating.value).toBe(4);
    expect(recorded.value.puzzleReview?.text).toBe("solid");
    expect(names(recorded.value)).toEqual(["PuzzleReviewed"]);
  });
});

describe("Completion round-trip", () => {
  it("rehydrates from state without re-emitting events", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const state = recorded.value.toState();
    const rehydrated = Completion.rehydrate(state);
    expect(rehydrated.toState()).toEqual(state);
    expect(rehydrated.pullEvents()).toEqual([]);
  });
});
