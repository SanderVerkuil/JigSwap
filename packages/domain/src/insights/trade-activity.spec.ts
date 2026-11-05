import { describe, expect, it } from "vitest";
import {
  computeTradeActivity,
  type ExchangeActivityInput,
} from "./trade-activity";

// A fixed "now" so the 12-month window is deterministic: 2026-03-09 UTC.
const NOW = Date.UTC(2026, 2, 9, 12, 0, 0);
const at = (year: number, monthIndex: number, day = 15): number =>
  Date.UTC(year, monthIndex, day);

describe("computeTradeActivity", () => {
  it("returns zero-filled statuses (fixed order) and a zero-filled 12-month window for empty input", () => {
    const activity = computeTradeActivity([], NOW);
    expect(activity.total).toBe(0);
    expect(activity.byMonth).toHaveLength(12);
    expect(activity.byMonth.every((m) => m.count === 0)).toBe(true);
    // Window ends at the current month and spans back 11 months, oldest first.
    expect(activity.byMonth[0]?.month).toBe("2025-04");
    expect(activity.byMonth[11]?.month).toBe("2026-03");
    expect(activity.byStatus).toEqual([
      { status: "proposed", count: 0 },
      { status: "accepted", count: 0 },
      { status: "completed", count: 0 },
      { status: "rejected", count: 0 },
      { status: "cancelled", count: 0 },
      { status: "disputed", count: 0 },
    ]);
  });

  it("counts by status while keeping the full fixed status order", () => {
    const exchanges: ExchangeActivityInput[] = [
      { status: "completed", createdAt: at(2026, 0) },
      { status: "completed", createdAt: at(2026, 0) },
      { status: "proposed", createdAt: at(2026, 0) },
      { status: "disputed", createdAt: at(2026, 0) },
    ];
    const activity = computeTradeActivity(exchanges, NOW);
    expect(activity.total).toBe(4);
    expect(activity.byStatus).toEqual([
      { status: "proposed", count: 1 },
      { status: "accepted", count: 0 },
      { status: "completed", count: 2 },
      { status: "rejected", count: 0 },
      { status: "cancelled", count: 0 },
      { status: "disputed", count: 1 },
    ]);
  });

  it("groups by UTC month and keeps quiet months as zero, so a gap stays a gap", () => {
    const activity = computeTradeActivity(
      [
        { status: "completed", createdAt: at(2026, 2) },
        { status: "proposed", createdAt: at(2026, 0) },
        { status: "rejected", createdAt: at(2026, 0) },
        { status: "accepted", createdAt: at(2025, 11) },
      ],
      NOW,
    );
    expect(activity.byMonth.slice(-4)).toEqual([
      { month: "2025-12", count: 1 },
      { month: "2026-01", count: 2 },
      { month: "2026-02", count: 0 },
      { month: "2026-03", count: 1 },
    ]);
  });

  it("places an exchange by its UTC month, not the local one", () => {
    const activity = computeTradeActivity(
      [
        { status: "proposed", createdAt: Date.UTC(2026, 1, 28, 23, 59) },
        { status: "proposed", createdAt: Date.UTC(2026, 2, 1, 0, 0) },
      ],
      NOW,
    );
    expect(activity.byMonth.slice(-2)).toEqual([
      { month: "2026-02", count: 1 },
      { month: "2026-03", count: 1 },
    ]);
  });

  it("leaves exchanges older than the window out of the months but not out of the totals", () => {
    const activity = computeTradeActivity(
      [
        { status: "completed", createdAt: at(2025, 3, 1) }, // 2025-04, first bucket
        { status: "completed", createdAt: at(2025, 2, 31) }, // 2025-03, just before the window
        { status: "completed", createdAt: at(2019, 5) },
      ],
      NOW,
    );
    expect(activity.total).toBe(3);
    expect(activity.byStatus.find((s) => s.status === "completed")?.count).toBe(
      3,
    );
    expect(activity.byMonth[0]).toEqual({ month: "2025-04", count: 1 });
    expect(activity.byMonth.reduce((sum, m) => sum + m.count, 0)).toBe(1);
    expect(activity.byMonth.some((m) => m.month === "2025-03")).toBe(false);
  });

  it("honours a custom window length across the year wrap", () => {
    const activity = computeTradeActivity([], Date.UTC(2026, 0, 15), 3);
    expect(activity.byMonth.map((m) => m.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });
});
