import { describe, expect, it } from "vitest";
import {
  computePersonalStats,
  type PersonalStatsInput,
} from "./personal-stats";

const empty: PersonalStatsInput = {
  completions: [],
  copies: [],
  collectionsCount: 0,
  exchanges: [],
  reviewsReceived: [],
  goals: [],
};

describe("computePersonalStats", () => {
  it("returns all-zero stats for empty input (no NaN from divide-by-zero)", () => {
    const stats = computePersonalStats(empty);
    expect(stats).toEqual({
      completionsCount: 0,
      totalSolveMinutes: 0,
      averageSolveMinutes: 0,
      puzzlesOwned: 0,
      distinctDefinitions: 0,
      collectionsCount: 0,
      exchangesCompleted: 0,
      averageRatingGiven: 0,
      averageRatingReceived: 0,
      goalsActive: 0,
      goalsAchieved: 0,
    });
    // Explicitly guard against NaN leaking through any average.
    expect(Number.isNaN(stats.averageSolveMinutes)).toBe(false);
    expect(Number.isNaN(stats.averageRatingGiven)).toBe(false);
    expect(Number.isNaN(stats.averageRatingReceived)).toBe(false);
  });

  it("counts only completed solves and sums/averages their solve minutes", () => {
    const stats = computePersonalStats({
      ...empty,
      completions: [
        { isCompleted: true, completionTimeMinutes: 60 },
        { isCompleted: true, completionTimeMinutes: 120 },
        // In-progress: excluded from count, total and average.
        { isCompleted: false, completionTimeMinutes: 999 },
      ],
    });
    expect(stats.completionsCount).toBe(2);
    expect(stats.totalSolveMinutes).toBe(180);
    expect(stats.averageSolveMinutes).toBe(90);
  });

  it("averages solve minutes over present samples only, not over all completed rows", () => {
    const stats = computePersonalStats({
      ...empty,
      completions: [
        { isCompleted: true, completionTimeMinutes: 100 },
        { isCompleted: true }, // no time recorded -> not in the denominator
      ],
    });
    expect(stats.completionsCount).toBe(2);
    expect(stats.totalSolveMinutes).toBe(100);
    // 100 / 1 sample, not 100 / 2.
    expect(stats.averageSolveMinutes).toBe(100);
  });

  it("counts owned copies and distinct definitions", () => {
    const stats = computePersonalStats({
      ...empty,
      copies: [
        { puzzleDefinitionKey: "def-a" },
        { puzzleDefinitionKey: "def-a" },
        { puzzleDefinitionKey: "def-b" },
        { puzzleDefinitionKey: undefined },
        { puzzleDefinitionKey: "" },
      ],
    });
    expect(stats.puzzlesOwned).toBe(5);
    // def-a, def-b only; undefined and "" do not count as definitions.
    expect(stats.distinctDefinitions).toBe(2);
  });

  it("counts only completed exchanges", () => {
    const stats = computePersonalStats({
      ...empty,
      exchanges: [
        { status: "completed" },
        { status: "completed" },
        { status: "proposed" },
        { status: "disputed" },
      ],
    });
    expect(stats.exchangesCompleted).toBe(2);
  });

  it("averages ratings given and received independently", () => {
    const stats = computePersonalStats({
      ...empty,
      completions: [
        { isCompleted: true, ratingGiven: 4 },
        { isCompleted: true, ratingGiven: 2 },
        { isCompleted: true }, // no rating -> excluded
      ],
      reviewsReceived: [{ rating: 5 }, { rating: 3 }, { rating: 1 }],
    });
    expect(stats.averageRatingGiven).toBe(3); // (4+2)/2
    expect(stats.averageRatingReceived).toBe(3); // (5+3+1)/3
  });

  it("counts active goals and achieved goals (achieved is derived, current >= target)", () => {
    const stats = computePersonalStats({
      ...empty,
      goals: [
        { isActive: true, targetCompletions: 10, currentCompletions: 3 },
        { isActive: true, targetCompletions: 5, currentCompletions: 5 }, // achieved + active
        { isActive: false, targetCompletions: 2, currentCompletions: 9 }, // achieved, inactive
        { isActive: false, targetCompletions: 4, currentCompletions: 1 },
      ],
    });
    expect(stats.goalsActive).toBe(2);
    expect(stats.goalsAchieved).toBe(2);
  });

  it("passes through collectionsCount verbatim", () => {
    expect(
      computePersonalStats({ ...empty, collectionsCount: 7 }).collectionsCount,
    ).toBe(7);
  });
});
