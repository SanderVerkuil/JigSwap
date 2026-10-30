import { describe, expect, it } from "vitest";
import { calendarDaysUntil } from "./loan-due";

// Built from local parts so the expectations hold in any time zone the tests run in.
const at = (month: number, day: number, hour = 12) =>
  new Date(2026, month, day, hour).getTime();

describe("calendarDaysUntil", () => {
  const now = new Date(2026, 9, 30, 15, 30);

  it("is 0 for any time today, whatever the hour", () => {
    expect(calendarDaysUntil(at(9, 30, 0), now)).toBe(0);
    expect(calendarDaysUntil(at(9, 30, 23), now)).toBe(0);
  });

  it("counts calendar days ahead and behind", () => {
    expect(calendarDaysUntil(at(9, 31, 0), now)).toBe(1);
    expect(calendarDaysUntil(at(10, 13), now)).toBe(14);
    expect(calendarDaysUntil(at(9, 29, 23), now)).toBe(-1);
    expect(calendarDaysUntil(at(9, 20), now)).toBe(-10);
  });

  it("counts whole days across a daylight-saving change", () => {
    // Europe's clocks go back on 25 Oct 2026, so that day lasts 25 hours there.
    expect(calendarDaysUntil(at(9, 26, 0), new Date(2026, 9, 24, 23))).toBe(2);
  });
});
