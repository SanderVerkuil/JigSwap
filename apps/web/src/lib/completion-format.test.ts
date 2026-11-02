import { createFormatter, createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import {
  countsTowardThisYear,
  formatCompletionDate,
  formatCompletionMeta,
  formatSolveTime,
  solveDuration,
  solveDurationText,
} from "./completion-format";

// The helper is typed for the app's hook; a catalog-backed translator behaves the same.
type T = Parameters<typeof formatCompletionDate>[0];
const tEn = createTranslator({
  locale: "en",
  messages: en,
  namespace: "solving.completions",
}) as unknown as T;
const tNl = createTranslator({
  locale: "nl",
  messages: nl,
  namespace: "solving.completions",
}) as unknown as T;
const fmtEn = createFormatter({ locale: "en", timeZone: "Europe/Amsterdam" });
const fmtNl = createFormatter({ locale: "nl", timeZone: "Europe/Amsterdam" });

// A stored solve date: the calendar date at UTC midnight (lib/date-input).
const MARCH = Date.UTC(2025, 2, 14);
const SENTINEL_2023 = Date.UTC(2023, 6, 1, 12);

describe("formatCompletionDate", () => {
  // The date follows the app locale, never the server's or browser's (UX-63).
  it("shows the date for a dated solve in the app locale, absent precision included", () => {
    expect(
      formatCompletionDate(tEn, fmtEn, { startDate: 0, endDate: MARCH }),
    ).toBe("Mar 14, 2025");
    expect(
      formatCompletionDate(tNl, fmtNl, {
        startDate: 0,
        endDate: MARCH,
        datePrecision: "day",
      }),
    ).toBe("14 mrt 2025");
  });

  it("falls back to the start date when there is no end", () => {
    expect(formatCompletionDate(tEn, fmtEn, { startDate: MARCH })).toBe(
      "Mar 14, 2025",
    );
  });

  it.each(["America/Los_Angeles", "Europe/Amsterdam"])(
    "shows the calendar date the member picked in %s, not the day before",
    (zone) => {
      const format = createFormatter({ locale: "en", timeZone: zone });
      expect(
        formatCompletionDate(tEn, format, { startDate: MARCH, endDate: MARCH }),
      ).toBe("Mar 14, 2025");
    },
  );

  it("labels a year-only solve with its year, never the sentinel date", () => {
    const solve = {
      startDate: SENTINEL_2023,
      endDate: SENTINEL_2023,
      datePrecision: "year" as const,
    };
    expect(formatCompletionDate(tEn, fmtEn, solve)).toBe("In 2023");
    expect(formatCompletionDate(tNl, fmtNl, solve)).toBe("In 2023");
  });

  it("labels an undated solve as date unknown", () => {
    const solve = {
      startDate: MARCH,
      endDate: MARCH,
      datePrecision: "unknown" as const,
    };
    expect(formatCompletionDate(tEn, fmtEn, solve)).toBe("Date unknown");
    expect(formatCompletionDate(tNl, fmtNl, solve)).toBe("Datum onbekend");
  });
});

describe("countsTowardThisYear", () => {
  const yearStart = Date.UTC(2026, 0, 1);
  const thisYear = Date.UTC(2026, 4, 2);
  const lastYear = Date.UTC(2025, 4, 2);

  it("counts dated and year-only solves inside the year", () => {
    expect(
      countsTowardThisYear({ startDate: 0, endDate: thisYear }, yearStart),
    ).toBe(true);
    expect(
      countsTowardThisYear(
        {
          startDate: 0,
          endDate: Date.UTC(2026, 6, 1, 12),
          datePrecision: "year",
        },
        yearStart,
      ),
    ).toBe(true);
  });

  it("counts a solve on 1 January and skips one on 31 December", () => {
    expect(
      countsTowardThisYear(
        { startDate: 0, endDate: Date.UTC(2026, 0, 1) },
        yearStart,
      ),
    ).toBe(true);
    expect(
      countsTowardThisYear(
        { startDate: 0, endDate: Date.UTC(2025, 11, 31) },
        yearStart,
      ),
    ).toBe(false);
  });

  it("skips solves from earlier years", () => {
    expect(
      countsTowardThisYear({ startDate: 0, endDate: lastYear }, yearStart),
    ).toBe(false);
    expect(
      countsTowardThisYear(
        { startDate: 0, endDate: SENTINEL_2023, datePrecision: "year" },
        yearStart,
      ),
    ).toBe(false);
  });

  it("never counts an undated solve, even though its sentinel is this year", () => {
    expect(
      countsTowardThisYear(
        { startDate: thisYear, endDate: thisYear, datePrecision: "unknown" },
        yearStart,
      ),
    ).toBe(false);
  });
});

describe("solveDuration", () => {
  const DAY = Date.UTC(2026, 9, 12);
  const days = (n: number) => DAY + n * 86_400_000;

  it("shows a typed time, on one day or across several", () => {
    expect(
      solveDuration({
        startDate: DAY,
        endDate: DAY,
        completionTimeMinutes: 200,
      }),
    ).toEqual({ kind: "time", minutes: 200 });
    expect(
      solveDuration({
        startDate: DAY,
        endDate: days(2),
        completionTimeMinutes: 300,
      }),
    ).toEqual({ kind: "time", minutes: 300 });
  });

  it("treats the one-day default of a same-day solve as no typed time", () => {
    expect(
      solveDuration({
        startDate: DAY,
        endDate: DAY,
        completionTimeMinutes: 1440,
      }),
    ).toEqual({ kind: "sameDay" });
  });

  it("treats a span-derived duration as no typed time and counts the calendar days", () => {
    expect(
      solveDuration({
        startDate: DAY,
        endDate: days(1),
        completionTimeMinutes: 1440,
      }),
    ).toEqual({ kind: "days", days: 2 });
    expect(
      solveDuration({
        startDate: DAY,
        endDate: days(2),
        completionTimeMinutes: 2880,
      }),
    ).toEqual({ kind: "days", days: 3 });
  });

  it("falls back to the dates when no duration is stored", () => {
    expect(solveDuration({ startDate: DAY, endDate: DAY })).toEqual({
      kind: "sameDay",
    });
    expect(solveDuration({ startDate: DAY, endDate: days(4) })).toEqual({
      kind: "days",
      days: 5,
    });
  });

  it("has no duration for an unfinished, year-only or undated solve", () => {
    expect(solveDuration({ startDate: DAY })).toBeNull();
    expect(
      solveDuration({
        startDate: SENTINEL_2023,
        endDate: SENTINEL_2023,
        datePrecision: "year",
      }),
    ).toBeNull();
    expect(
      solveDuration({ startDate: DAY, endDate: DAY, datePrecision: "unknown" }),
    ).toBeNull();
  });
});

describe("formatSolveTime", () => {
  it("writes minutes, hours and days compactly in English", () => {
    expect(formatSolveTime(tEn, 45)).toBe("45m");
    expect(formatSolveTime(tEn, 200)).toBe("3h 20m");
    expect(formatSolveTime(tEn, 2880)).toBe("2 days");
    expect(formatSolveTime(tEn, 1440 + 125)).toBe("1d 2h 5m");
  });

  // "m" reads as metres in Dutch: minutes are "min", hours "u", days "d", always spaced.
  it("writes them the Dutch way", () => {
    expect(formatSolveTime(tNl, 45)).toBe("45 min");
    expect(formatSolveTime(tNl, 200)).toBe("3 u 20 min");
    expect(formatSolveTime(tNl, 2880)).toBe("2 dagen");
    expect(formatSolveTime(tNl, 1440 + 125)).toBe("1 d 2 u 5 min");
  });

  it("says when no time was recorded", () => {
    expect(formatSolveTime(tEn)).toBe("No time recorded");
  });
});

describe("formatCompletionMeta", () => {
  const DAY = Date.UTC(2026, 9, 12);
  const finished = (
    endDate: number,
    completionTimeMinutes?: number,
    datePrecision?: "day" | "year" | "unknown",
  ) => ({
    isCompleted: true,
    startDate: DAY,
    endDate,
    completionTimeMinutes,
    datePrecision,
  });

  it("shows pieces and the typed time", () => {
    expect(formatCompletionMeta(tEn, fmtEn, finished(DAY, 200), 1000)).toBe(
      "1,000 pieces · 3h 20m",
    );
    expect(formatCompletionMeta(tNl, fmtNl, finished(DAY, 200), 1000)).toBe(
      "1.000 stukjes · 3 u 20 min",
    );
  });

  it("says a same-day solve without a typed time took one day", () => {
    expect(formatCompletionMeta(tEn, fmtEn, finished(DAY, 1440), 500)).toBe(
      "500 pieces · in one day",
    );
    expect(formatCompletionMeta(tNl, fmtNl, finished(DAY, 1440), 500)).toBe(
      "500 stukjes · op één dag",
    );
  });

  it("says a solve without a typed time spread over the calendar days it spans", () => {
    const end = DAY + 2 * 86_400_000;
    expect(formatCompletionMeta(tEn, fmtEn, finished(end, 2880), 1000)).toBe(
      "1,000 pieces · over 3 days",
    );
    expect(formatCompletionMeta(tNl, fmtNl, finished(end, 2880), 1000)).toBe(
      "1.000 stukjes · verspreid over 3 dagen",
    );
  });

  it("leads with Completed when the piece count is unknown", () => {
    expect(formatCompletionMeta(tEn, fmtEn, finished(DAY, 200))).toBe(
      "Completed · 3h 20m",
    );
  });

  it("never invents a duration for a year-only or undated solve", () => {
    expect(
      formatCompletionMeta(
        tEn,
        fmtEn,
        finished(SENTINEL_2023, undefined, "year"),
        1000,
      ),
    ).toBe("1,000 pieces");
    expect(
      formatCompletionMeta(tNl, fmtNl, finished(DAY, undefined, "unknown")),
    ).toBe("Voltooid");
  });

  it("shows when an in-progress solve started, as the calendar date picked", () => {
    expect(
      formatCompletionMeta(
        tEn,
        fmtEn,
        { isCompleted: false, startDate: DAY },
        1000,
      ),
    ).toBe("Started Oct 12, 2026");
  });
});

// The profile's solves list says the same as the member's own log: a typed time, or the span.
describe("solveDurationText", () => {
  const DAY_MS = 86_400_000;
  const START = Date.UTC(2026, 9, 1);

  it("says the time a member typed", () => {
    expect(
      solveDurationText(tEn, {
        startDate: START,
        endDate: START,
        completionTimeMinutes: 200,
      }),
    ).toBe("3h 20m");
  });

  it("never turns the domain's derived duration into a time", () => {
    expect(
      solveDurationText(tEn, {
        startDate: START,
        endDate: START,
        completionTimeMinutes: 1440,
      }),
    ).toBe("in one day");
    expect(
      solveDurationText(tEn, {
        startDate: START,
        endDate: START + 2 * DAY_MS,
        completionTimeMinutes: 2880,
      }),
    ).toBe("over 3 days");
  });

  it("says nothing for a year-only solve", () => {
    expect(
      solveDurationText(tEn, {
        startDate: START,
        endDate: START,
        datePrecision: "year",
        completionTimeMinutes: 200,
      }),
    ).toBeNull();
  });
});
