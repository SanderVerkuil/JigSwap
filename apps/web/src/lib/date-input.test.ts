import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calendarDaysAgo,
  dateInputToMs,
  formatDateOnly,
  localTodayInput,
  msToDateInput,
} from "./date-input";

// A solve date is a calendar date stored as UTC midnight. These helpers must give the same answer
// in every time zone, so each case runs under zones on both sides of UTC.
const ZONES = [
  "UTC",
  "Europe/Amsterdam",
  "Pacific/Auckland",
  "America/Los_Angeles",
];

describe.each(ZONES)("date inputs in %s", (zone) => {
  beforeEach(() => {
    vi.stubEnv("TZ", zone);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("today is the member's local calendar day, also just after local midnight", () => {
    expect(localTodayInput(new Date(2026, 9, 30, 0, 30))).toBe("2026-10-30");
    expect(localTodayInput(new Date(2026, 9, 30, 23, 30))).toBe("2026-10-30");
    expect(localTodayInput(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("stores a picked date as UTC midnight of that calendar date", () => {
    expect(dateInputToMs("2026-10-30")).toBe(Date.UTC(2026, 9, 30));
    expect(dateInputToMs("2026-01-01")).toBe(Date.UTC(2026, 0, 1));
  });

  it("reads a stored date back as the same calendar date", () => {
    expect(msToDateInput(Date.UTC(2026, 9, 30))).toBe("2026-10-30");
    expect(msToDateInput(dateInputToMs("2024-02-29"))).toBe("2024-02-29");
    expect(msToDateInput(Date.UTC(2026, 0, 1))).toBe("2026-01-01");
  });

  it("formats a stored date as its calendar date, never the day before or after", () => {
    const stored = Date.UTC(2026, 9, 30);
    expect(formatDateOnly(stored, "en-GB")).toBe("30/10/2026");
    expect(formatDateOnly(stored, "nl-NL")).toBe("30-10-2026");
  });

  it("counts calendar days from a stored date to the local today", () => {
    const start = Date.UTC(2026, 9, 30);
    expect(calendarDaysAgo(start, new Date(2026, 9, 30, 0, 30))).toBe(0);
    expect(calendarDaysAgo(start, new Date(2026, 9, 30, 23, 30))).toBe(0);
    expect(calendarDaysAgo(start, new Date(2026, 9, 31, 0, 30))).toBe(1);
    expect(calendarDaysAgo(start, new Date(2026, 10, 2, 12))).toBe(3);
    expect(calendarDaysAgo(start, new Date(2026, 9, 28, 12))).toBe(-2);
  });
});

describe("date input edge cases", () => {
  it("gives undefined for an empty or malformed value", () => {
    expect(dateInputToMs("")).toBeUndefined();
    expect(dateInputToMs("2026-13-01")).toBeUndefined();
    expect(dateInputToMs("2026-02-30")).toBeUndefined();
    expect(dateInputToMs("30-10-2026")).toBeUndefined();
  });

  it("gives an empty input value for no date", () => {
    expect(msToDateInput(undefined)).toBe("");
  });

  it("pads years before 1000 so the input accepts them", () => {
    expect(msToDateInput(Date.UTC(950, 4, 6))).toBe("0950-05-06");
  });

  it("counts a legacy instant by its UTC calendar day", () => {
    const legacyStart = Date.UTC(2026, 9, 29, 15);
    expect(calendarDaysAgo(legacyStart, new Date(2026, 9, 30, 12))).toBe(1);
  });
});
