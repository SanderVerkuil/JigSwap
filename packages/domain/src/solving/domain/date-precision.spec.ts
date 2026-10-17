import { describe, expect, it } from "vitest";
import {
  countsTowardGoals,
  MIN_SOLVE_YEAR,
  yearSentinel,
} from "./date-precision";

describe("countsTowardGoals", () => {
  it("counts dated and year-only solves but not undated ones (decision 4)", () => {
    expect(countsTowardGoals("day")).toBe(true);
    expect(countsTowardGoals("year")).toBe(true);
    expect(countsTowardGoals("unknown")).toBe(false);
  });
});

describe("yearSentinel", () => {
  const NOW = new Date("2026-10-17T08:00:00Z");

  it("is mid-year at UTC noon for a past year", () => {
    expect(yearSentinel(2023, NOW).toISOString()).toBe(
      "2023-07-01T12:00:00.000Z",
    );
  });

  it("never lies in the future for the current year", () => {
    const january = new Date("2026-01-05T09:00:00Z");
    expect(yearSentinel(2026, january).getTime()).toBe(january.getTime());
  });

  it("stays mid-year for the current year once mid-year has passed", () => {
    expect(yearSentinel(2026, NOW).toISOString()).toBe(
      "2026-07-01T12:00:00.000Z",
    );
  });

  it("is exactly now on the sentinel instant itself", () => {
    const sentinel = new Date("2026-07-01T12:00:00Z");
    expect(yearSentinel(2026, sentinel).getTime()).toBe(sentinel.getTime());
  });

  it("exposes the lowest accepted year", () => {
    expect(MIN_SOLVE_YEAR).toBe(1900);
  });
});
