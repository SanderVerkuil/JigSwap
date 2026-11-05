import { describe, expect, it } from "vitest";
import { lastMonthKeys, monthKey } from "./month-window";

describe("monthKey", () => {
  it("keys an instant by its UTC calendar month, zero-padded", () => {
    expect(monthKey(Date.UTC(2026, 1, 28, 23, 59, 59))).toBe("2026-02");
    expect(monthKey(Date.UTC(2026, 2, 1, 0, 0, 0))).toBe("2026-03");
    expect(monthKey(Date.UTC(2026, 11, 31, 23, 59))).toBe("2026-12");
  });
});

describe("lastMonthKeys", () => {
  it("ends at the month of now and runs oldest first", () => {
    expect(lastMonthKeys(Date.UTC(2026, 5, 9, 12), 12)).toEqual([
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("uses the UTC month of now, on both edges of a month", () => {
    expect(lastMonthKeys(Date.UTC(2026, 0, 31, 23, 59), 2)).toEqual([
      "2025-12",
      "2026-01",
    ]);
    expect(lastMonthKeys(Date.UTC(2026, 1, 1, 0, 0), 2)).toEqual([
      "2026-01",
      "2026-02",
    ]);
  });

  it("wraps across more than one year", () => {
    expect(lastMonthKeys(Date.UTC(2026, 0, 15), 14)[0]).toBe("2024-12");
  });

  it("returns exactly the requested number of months", () => {
    expect(lastMonthKeys(Date.UTC(2026, 0, 15), 1)).toEqual(["2026-01"]);
    expect(lastMonthKeys(Date.UTC(2026, 0, 15), 0)).toEqual([]);
  });
});
