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
    expect(result.value.photos).toEqual([]); // defaults to no photos
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
    expect(result.value.photos).toEqual([]); // defaults to no photos
    expect(result.value.toState().completionTimeMinutes).toBe(90);
    expect(names(result.value)).toEqual(["CompletionRecorded"]);
  });

  it("allows exactly five photos", () => {
    const result = recordValid({ photos: photos(5) });
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.photos).toHaveLength(5);
  });

  it("rejects an end before start with InvalidTimeRange", () => {
    const result = recordValid({ endDate: new Date("2026-06-01T09:00:00Z") });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidTimeRange");
  });

  it("allows equal start/end (same-day) and counts one day (1440 minutes)", () => {
    const result = recordValid({ endDate: START });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.isCompleted).toBe(true);
    expect(result.value.toState().completionTimeMinutes).toBe(1440);
  });

  it("allows equal start/end with an explicit positive time and stores that time", () => {
    const result = recordValid({ endDate: START, completionTimeMinutes: 45 });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.toState().completionTimeMinutes).toBe(45);
  });

  it("honours an explicit completionTimeMinutes over the span", () => {
    const result = recordValid({ completionTimeMinutes: 45 });
    expect(result.isOk).toBe(true);
    if (result.isOk)
      expect(result.value.toState().completionTimeMinutes).toBe(45);
  });

  it("derives a multi-day span in minutes rather than the one-day fallback", () => {
    const result = recordValid({
      endDate: new Date("2026-06-03T10:00:00Z"), // 2 days after START
    });
    expect(result.isOk).toBe(true);
    if (result.isOk)
      expect(result.value.toState().completionTimeMinutes).toBe(2880);
  });

  it("rejects more than five photos", () => {
    const result = recordValid({ photos: photos(6) });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("TooManyPhotos");
  });

  it("rejects an explicit negative completionTimeMinutes with InvalidDuration", () => {
    const result = recordValid({ completionTimeMinutes: -5 });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
  });

  it("rejects a derived sub-30-second span with InvalidDuration", () => {
    const result = recordValid({
      endDate: new Date(START.getTime() + 10_000), // 10s span, no explicit minutes
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
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

  it("finishes with equal end/start (same-day) and counts one day (1440 minutes)", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    if (!started.isOk) throw new Error("setup failed");
    started.value.pullEvents();

    const outcome = started.value.finish(START, NOW);
    expect(outcome.isOk).toBe(true);
    expect(started.value.toState().completionTimeMinutes).toBe(1440);
  });

  it("accepts an equal end/start when an explicit duration is supplied", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    if (!started.isOk) throw new Error("setup failed");
    const outcome = started.value.finish(START, NOW, 15);
    expect(outcome.isOk).toBe(true);
    expect(started.value.toState().completionTimeMinutes).toBe(15);
  });

  it("rejects finishing with an invalid explicit duration", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    if (!started.isOk) throw new Error("setup failed");
    const outcome = started.value.finish(END, NOW, -5);
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("InvalidDuration");
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

  it("treats the edit window as exactly 24 hours from the end (inclusive)", () => {
    const DAY_MS = 86_400_000; // hardcoded so the EDIT_WINDOW_MS arithmetic is actually pinned
    const onEdge = recordValid();
    if (!onEdge.isOk) throw new Error("setup failed");
    expect(
      onEdge.value.edit(
        ALICE,
        { notes: "edge" },
        new Date(END.getTime() + DAY_MS),
      ).isOk,
    ).toBe(true);

    const justPast = recordValid();
    if (!justPast.isOk) throw new Error("setup failed");
    const outcome = justPast.value.edit(
      ALICE,
      { notes: "late" },
      new Date(END.getTime() + DAY_MS + 1),
    );
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("EditWindowClosed");
  });

  it("anchors the edit window on the completion's end, not its updatedAt", () => {
    // Recorded two hours after the solve actually ended.
    const recorded = recordValid({
      now: new Date(END.getTime() + 2 * 60 * 60 * 1000),
    });
    if (!recorded.isOk) throw new Error("setup failed");
    // 25h after the end (closed) but only 23h after updatedAt — must be closed.
    const outcome = recorded.value.edit(
      ALICE,
      { notes: "late" },
      new Date(END.getTime() + 25 * 60 * 60 * 1000),
    );
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("EditWindowClosed");
  });

  it("leaves the end and duration untouched when neither is edited", () => {
    const recorded = recordValid({ completionTimeMinutes: 45 }); // span is 90, stored 45
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(ALICE, { notes: "only notes" }, END);
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.toState().endDate).toEqual(END);
    expect(recorded.value.toState().completionTimeMinutes).toBe(45);
  });

  it("allows an edit with exactly five photos", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(ALICE, { photos: photos(5) }, END);
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.photos).toHaveLength(5);
  });

  it("accepts an equal end/start edit with an explicit duration", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(
      ALICE,
      { endDate: START, completionTimeMinutes: 15 },
      END,
    );
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.toState().completionTimeMinutes).toBe(15);
  });

  it("edits to equal end/start without explicit minutes and counts one day (1440 minutes)", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(ALICE, { endDate: START }, END);
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.toState().completionTimeMinutes).toBe(1440);
  });

  it("recomputes duration when only the explicit minutes change", () => {
    const recorded = recordValid(); // span 90
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(
      ALICE,
      { completionTimeMinutes: 20 },
      END,
    );
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.toState().completionTimeMinutes).toBe(20);
  });

  it("recomputes duration when only the start date changes", () => {
    const recorded = recordValid(); // 10:00–11:30 = 90
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(
      ALICE,
      { startDate: new Date("2026-06-01T10:30:00Z") },
      END,
    );
    expect(outcome.isOk).toBe(true);
    expect(recorded.value.toState().completionTimeMinutes).toBe(60);
  });

  it("rejects an edit whose explicit duration is invalid", () => {
    const recorded = recordValid();
    if (!recorded.isOk) throw new Error("setup failed");
    const outcome = recorded.value.edit(
      ALICE,
      { completionTimeMinutes: -5 },
      END,
    );
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("InvalidDuration");
  });

  describe("editing an in-progress completion", () => {
    const inProgress = () => {
      const started = Completion.start({
        id: ID,
        userId: ALICE,
        startDate: START,
        now: NOW,
      });
      if (!started.isOk) throw new Error("setup failed");
      started.value.pullEvents();
      return started.value;
    };

    it("moves the start date without deriving a duration from a missing end", () => {
      const completion = inProgress();
      const newStart = new Date("2026-06-01T10:15:00Z");
      const outcome = completion.edit(ALICE, { startDate: newStart }, NOW);
      expect(outcome.isOk).toBe(true);
      expect(completion.toState().startDate).toEqual(newStart);
      expect(completion.toState().completionTimeMinutes).toBeUndefined();
    });

    it("sets the duration directly from explicit minutes (no end yet)", () => {
      const completion = inProgress();
      const outcome = completion.edit(
        ALICE,
        { completionTimeMinutes: 30 },
        NOW,
      );
      expect(outcome.isOk).toBe(true);
      expect(completion.toState().completionTimeMinutes).toBe(30);
    });

    it("rejects invalid explicit minutes (no end yet)", () => {
      const completion = inProgress();
      const outcome = completion.edit(
        ALICE,
        { completionTimeMinutes: -5 },
        NOW,
      );
      expect(outcome.isErr).toBe(true);
      if (outcome.isErr) expect(outcome.error.code).toBe("InvalidDuration");
    });
  });
});

describe("Completion.allPiecesPresent", () => {
  it("defaults to undefined when not provided", () => {
    const result = recordValid();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.toState().allPiecesPresent).toBeUndefined();
  });

  it("carries allPiecesPresent=false through record()", () => {
    const result = recordValid({ allPiecesPresent: false });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.toState().allPiecesPresent).toBe(false);
  });

  it("carries allPiecesPresent through start()", () => {
    const result = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
      allPiecesPresent: true,
    });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.toState().allPiecesPresent).toBe(true);
  });

  it("finish() sets allPiecesPresent when provided and leaves it otherwise", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    expect(started.isOk).toBe(true);
    if (!started.isOk) return;
    const c = started.value;
    const outcome = c.finish(END, NOW, undefined, true);
    expect(outcome.isOk).toBe(true);
    expect(c.toState().allPiecesPresent).toBe(true);
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
