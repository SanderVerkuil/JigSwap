import { describe, expect, it } from "vitest";
import {
  type ExchangeActivityInput,
  computeTradeActivity,
} from "./trade-activity";

const at = (year: number, monthIndex: number): number =>
  Date.UTC(year, monthIndex, 15);

describe("computeTradeActivity", () => {
  it("returns zero-filled statuses (fixed order) and no months for empty input", () => {
    const activity = computeTradeActivity([]);
    expect(activity.total).toBe(0);
    expect(activity.byMonth).toEqual([]);
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
    const activity = computeTradeActivity(exchanges);
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

  it("groups by UTC month, only emitting active months, sorted oldest->newest", () => {
    const activity = computeTradeActivity([
      { status: "completed", createdAt: at(2026, 2) },
      { status: "proposed", createdAt: at(2026, 0) },
      { status: "rejected", createdAt: at(2026, 0) },
      { status: "accepted", createdAt: at(2025, 11) },
    ]);
    expect(activity.byMonth).toEqual([
      { month: "2025-12", count: 1 },
      { month: "2026-01", count: 2 },
      { month: "2026-03", count: 1 },
    ]);
  });
});
