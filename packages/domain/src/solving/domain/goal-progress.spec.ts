import { describe, expect, it } from "vitest";
import { DatePrecision } from "./date-precision";
import {
  countsTowardGoal,
  countTowardGoal,
  goalCountingWindow,
  GoalWindow,
} from "./goal-progress";

const at = (iso: string) => new Date(iso);
const solve = (iso: string, datePrecision: DatePrecision = "day") => ({
  endDate: at(iso),
  datePrecision,
});

describe("goalCountingWindow", () => {
  it("starts at the UTC day of the start date and ends after the UTC day of the target date", () => {
    const window = goalCountingWindow({
      startDate: at("2026-01-01T15:45:00Z"),
      createdAt: at("2026-10-30T09:00:00Z"),
      targetDate: at("2026-12-31T08:00:00Z"),
    });
    expect(window.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(window.toExclusive?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("falls back to the UTC day the goal was created when it has no start date", () => {
    const window = goalCountingWindow({
      createdAt: at("2026-10-30T23:30:00Z"),
      targetDate: at("2026-11-01T00:00:00Z"),
    });
    expect(window.from.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(window.toExclusive?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("is open-ended when the goal has no target date", () => {
    const window = goalCountingWindow({
      createdAt: at("2026-10-30T09:00:00Z"),
    });
    expect(window.from.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(window.toExclusive).toBeUndefined();
  });
});

describe("countsTowardGoal", () => {
  // The whole of 2026, as a goal from 1 January to 31 December.
  const year2026: GoalWindow = {
    from: at("2026-01-01T00:00:00Z"),
    toExclusive: at("2027-01-01T00:00:00Z"),
  };
  // A goal created on 30 October 2026 with no end date.
  const openEnded: GoalWindow = { from: at("2026-10-30T00:00:00Z") };

  describe("a solve dated to the day", () => {
    it("counts on the first instant of the first day", () => {
      expect(countsTowardGoal(solve("2026-01-01T00:00:00Z"), year2026)).toBe(
        true,
      );
    });

    it("does not count the instant before the window opens", () => {
      expect(
        countsTowardGoal(solve("2025-12-31T23:59:59.999Z"), year2026),
      ).toBe(false);
    });

    it("counts on the last instant of the last day", () => {
      expect(
        countsTowardGoal(solve("2026-12-31T23:59:59.999Z"), year2026),
      ).toBe(true);
    });

    it("does not count from the day after the target date", () => {
      expect(countsTowardGoal(solve("2027-01-01T00:00:00Z"), year2026)).toBe(
        false,
      );
    });

    it("counts any later solve when the goal is open-ended", () => {
      expect(countsTowardGoal(solve("2040-06-01T00:00:00Z"), openEnded)).toBe(
        true,
      );
      expect(
        countsTowardGoal(solve("2026-10-29T23:59:59.999Z"), openEnded),
      ).toBe(false);
    });
  });

  describe("a solve dated only to a year", () => {
    it("counts when its year overlaps the window", () => {
      expect(
        countsTowardGoal(solve("2026-07-01T12:00:00Z", "year"), year2026),
      ).toBe(true);
    });

    it("counts when the window covers only the last day of its year", () => {
      const lastDay: GoalWindow = {
        from: at("2025-12-31T00:00:00Z"),
        toExclusive: at("2026-02-01T00:00:00Z"),
      };
      expect(
        countsTowardGoal(solve("2025-07-01T12:00:00Z", "year"), lastDay),
      ).toBe(true);
    });

    it("counts when the window covers only the first day of its year", () => {
      const firstDay: GoalWindow = {
        from: at("2025-06-01T00:00:00Z"),
        toExclusive: at("2026-01-02T00:00:00Z"),
      };
      expect(
        countsTowardGoal(solve("2026-07-01T12:00:00Z", "year"), firstDay),
      ).toBe(true);
    });

    it("does not count a year that ends as the window opens", () => {
      expect(
        countsTowardGoal(solve("2025-07-01T12:00:00Z", "year"), year2026),
      ).toBe(false);
    });

    it("does not count a year that starts as the window closes", () => {
      expect(
        countsTowardGoal(solve("2027-07-01T12:00:00Z", "year"), year2026),
      ).toBe(false);
    });

    it("counts the year itself even when its sentinel lies before an open-ended window", () => {
      // A 2026 import is stored on 1 July; a goal opened in October still overlaps 2026.
      expect(
        countsTowardGoal(solve("2026-07-01T12:00:00Z", "year"), openEnded),
      ).toBe(true);
      expect(
        countsTowardGoal(solve("2025-07-01T12:00:00Z", "year"), openEnded),
      ).toBe(false);
    });
  });

  describe("an undated solve", () => {
    it("never counts, even when its stored instant lies in the window", () => {
      expect(
        countsTowardGoal(solve("2026-06-01T00:00:00Z", "unknown"), year2026),
      ).toBe(false);
    });
  });
});

describe("countTowardGoal", () => {
  it("counts only the solves inside the window", () => {
    const window: GoalWindow = {
      from: at("2026-10-30T00:00:00Z"),
      toExclusive: at("2027-01-01T00:00:00Z"),
    };
    const solves = [
      solve("2024-03-01T10:00:00Z"),
      solve("2026-10-29T22:00:00Z"),
      solve("2026-10-30T08:00:00Z"),
      solve("2026-11-15T00:00:00Z"),
      solve("2026-07-01T12:00:00Z", "year"),
      solve("2026-11-01T00:00:00Z", "unknown"),
    ];
    expect(countTowardGoal(solves, window)).toBe(3);
  });

  it("is zero without solves", () => {
    expect(countTowardGoal([], { from: at("2026-01-01T00:00:00Z") })).toBe(0);
  });
});
