import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
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

const MARCH = new Date(2025, 2, 14).getTime();
const SENTINEL_2023 = Date.UTC(2023, 6, 1, 12);

describe("formatCompletionDate", () => {
  it("shows the date for a dated solve, absent precision included", () => {
    const expected = new Date(MARCH).toLocaleDateString();
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
    expect(formatCompletionDate(tEn, { startDate: MARCH })).toBe(
      new Date(MARCH).toLocaleDateString(),
    );
  });

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
  const yearStart = new Date(2026, 0, 1).getTime();
  const thisYear = new Date(2026, 4, 2).getTime();
  const lastYear = new Date(2025, 4, 2).getTime();

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
