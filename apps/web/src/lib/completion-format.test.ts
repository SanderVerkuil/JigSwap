import { createTranslator } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import {
  countsTowardThisYear,
  formatCompletionDate,
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

// A stored solve date: the calendar date at UTC midnight (lib/date-input).
const MARCH = Date.UTC(2025, 2, 14);
const inUtc = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { timeZone: "UTC" });
const SENTINEL_2023 = Date.UTC(2023, 6, 1, 12);

describe("formatCompletionDate", () => {
  it("shows the date for a dated solve, absent precision included", () => {
    const expected = inUtc(MARCH);
    expect(formatCompletionDate(tEn, { startDate: 0, endDate: MARCH })).toBe(
      expected,
    );
    expect(
      formatCompletionDate(tEn, {
        startDate: 0,
        endDate: MARCH,
        datePrecision: "day",
      }),
    ).toBe(expected);
  });

  it("falls back to the start date when there is no end", () => {
    expect(formatCompletionDate(tEn, { startDate: MARCH })).toBe(inUtc(MARCH));
  });

  describe.each(["America/Los_Angeles", "Europe/Amsterdam"])(
    "in %s",
    (zone) => {
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("shows the calendar date the member picked, not the day before", () => {
        vi.stubEnv("TZ", zone);
        // Noon UTC is the same calendar day in both zones, so its local date is the expected one.
        const sameDayLocal = new Date(
          Date.UTC(2025, 2, 14, 12),
        ).toLocaleDateString();
        expect(
          formatCompletionDate(tEn, { startDate: MARCH, endDate: MARCH }),
        ).toBe(sameDayLocal);
      });
    },
  );

  it("labels a year-only solve with its year, never the sentinel date", () => {
    const solve = {
      startDate: SENTINEL_2023,
      endDate: SENTINEL_2023,
      datePrecision: "year" as const,
    };
    expect(formatCompletionDate(tEn, solve)).toBe("In 2023");
    expect(formatCompletionDate(tNl, solve)).toBe("In 2023");
  });

  it("labels an undated solve as date unknown", () => {
    const solve = {
      startDate: MARCH,
      endDate: MARCH,
      datePrecision: "unknown" as const,
    };
    expect(formatCompletionDate(tEn, solve)).toBe("Date unknown");
    expect(formatCompletionDate(tNl, solve)).toBe("Datum onbekend");
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
