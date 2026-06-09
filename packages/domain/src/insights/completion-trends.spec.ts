import { describe, expect, it } from "vitest";
import { computeCompletionTrends } from "./completion-trends";

// A fixed "now" so the 12-month window is deterministic: 2026-06-09 UTC.
const NOW = Date.UTC(2026, 5, 9, 12, 0, 0);
const at = (year: number, monthIndex: number, day = 15): number =>
  Date.UTC(year, monthIndex, day);

describe("computeCompletionTrends", () => {
  it("returns a zero-filled 12-month window for empty input, sorted oldest->newest", () => {
    const points = computeCompletionTrends([], NOW);
    expect(points).toHaveLength(12);
    expect(points.every((p) => p.count === 0 && p.totalMinutes === 0)).toBe(true);
    // Window ends at the current month and spans back 11 months.
    expect(points[0]?.month).toBe("2025-07");
    expect(points[11]?.month).toBe("2026-06");
    // Sorted ascending.
    const months = points.map((p) => p.month);
    expect([...months].sort()).toEqual(months);
  });

  it("groups completions into their UTC month and sums count + minutes", () => {
    const points = computeCompletionTrends(
      [
        { completedAt: at(2026, 5, 1), completionTimeMinutes: 60 },
        { completedAt: at(2026, 5, 20), completionTimeMinutes: 30 },
        { completedAt: at(2026, 4, 10), completionTimeMinutes: 90 },
      ],
      NOW,
    );
    const june = points.find((p) => p.month === "2026-06");
    const may = points.find((p) => p.month === "2026-05");
    expect(june).toEqual({ month: "2026-06", count: 2, totalMinutes: 90 });
    expect(may).toEqual({ month: "2026-05", count: 1, totalMinutes: 90 });
  });

  it("treats a missing completion time as zero minutes but still counts it", () => {
    const points = computeCompletionTrends(
      [{ completedAt: at(2026, 5, 5) }],
      NOW,
    );
    const june = points.find((p) => p.month === "2026-06");
    expect(june).toEqual({ month: "2026-06", count: 1, totalMinutes: 0 });
  });

  it("ignores completions older than the window", () => {
    const points = computeCompletionTrends(
      [{ completedAt: at(2024, 0, 1), completionTimeMinutes: 100 }],
      NOW,
    );
    expect(points.every((p) => p.count === 0)).toBe(true);
    expect(points.some((p) => p.month === "2024-01")).toBe(false);
  });

  it("includes the oldest in-window month edge but excludes the month just before it", () => {
    const inWindow = at(2025, 6, 1); // 2025-07, first bucket
    const justOutside = at(2025, 5, 30); // 2025-06, one month before the window
    const points = computeCompletionTrends(
      [
        { completedAt: inWindow, completionTimeMinutes: 10 },
        { completedAt: justOutside, completionTimeMinutes: 10 },
      ],
      NOW,
    );
    expect(points.find((p) => p.month === "2025-07")?.count).toBe(1);
    expect(points.some((p) => p.month === "2025-06")).toBe(false);
  });

  it("handles the January->December year wrap when seeding the window", () => {
    const jan = Date.UTC(2026, 0, 15);
    const points = computeCompletionTrends([], jan, 3);
    expect(points.map((p) => p.month)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("honours a custom window length", () => {
    const points = computeCompletionTrends([], NOW, 3);
    expect(points.map((p) => p.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});
