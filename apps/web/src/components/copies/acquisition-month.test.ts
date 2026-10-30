import { describe, expect, it } from "vitest";
import { acquisitionMonthOf, acquisitionMonthStart } from "./acquisition-month";

// The Edit dialog records "Acquired" as a month and year. The stored value is an instant, read in
// the app's time zone, so a month picked in the dialog must come back as the same month.

describe("acquisition month", () => {
  it("stores a picked month as noon UTC on its first day", () => {
    expect(new Date(acquisitionMonthStart(2025, 3)).toISOString()).toBe(
      "2025-03-01T12:00:00.000Z",
    );
  });

  it("reads a stored instant as the month it falls in, in the given time zone", () => {
    // 31 March 23:30 UTC is already 1 April in Amsterdam.
    expect(
      acquisitionMonthOf(Date.UTC(2025, 2, 31, 23, 30), "Europe/Amsterdam"),
    ).toEqual({ year: 2025, month: 4 });
    expect(acquisitionMonthOf(Date.UTC(2025, 2, 31, 23, 30), "UTC")).toEqual({
      year: 2025,
      month: 3,
    });
  });

  it("round-trips every month in time zones from UTC-12 to UTC+14", () => {
    for (const zone of [
      "Etc/GMT+12",
      "America/New_York",
      "Europe/Amsterdam",
      "Pacific/Kiritimati",
    ]) {
      for (let month = 1; month <= 12; month++) {
        expect(
          acquisitionMonthOf(acquisitionMonthStart(2024, month), zone),
        ).toEqual({ year: 2024, month });
      }
    }
  });
});
