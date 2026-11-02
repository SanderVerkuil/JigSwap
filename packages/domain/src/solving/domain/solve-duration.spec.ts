import { describe, expect, it } from "vitest";
import {
  isPlausibleSolveMinutes,
  MAX_SOLVE_MINUTES,
  SolveDuration,
  typedSolveMinutes,
} from "./solve-duration";

describe("SolveDuration", () => {
  it("accepts a positive number of minutes", () => {
    const result = SolveDuration.ofMinutes(90);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.minutes).toBe(90);
  });

  it("rounds a fractional duration to whole minutes", () => {
    const result = SolveDuration.ofMinutes(90.4);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.minutes).toBe(90);
  });

  it("rejects a sub-30-second span that would round down to zero", () => {
    // Rounds to 0 before the fix's re-ordering — the positive-minutes invariant must reject it,
    // never store a 0.
    const result = SolveDuration.ofMinutes(0.2);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
  });

  it("rounds a span at the half-minute boundary up to one minute", () => {
    const result = SolveDuration.ofMinutes(0.6);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.minutes).toBe(1);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %p with InvalidDuration",
    (value) => {
      const result = SolveDuration.ofMinutes(value);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
    },
  );

  // One solve of Number.MAX_VALUE minutes used to become a definition's public average.
  it("accepts a duration up to ten years and nothing longer", () => {
    expect(MAX_SOLVE_MINUTES).toBe(10 * 365 * 1440);
    expect(SolveDuration.ofMinutes(MAX_SOLVE_MINUTES).isOk).toBe(true);
    for (const minutes of [MAX_SOLVE_MINUTES + 1, 1e300, Number.MAX_VALUE]) {
      const result = SolveDuration.ofMinutes(minutes);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
    }
  });

  it("derives a duration from a start/end span", () => {
    const start = new Date("2026-06-01T10:00:00Z");
    const end = new Date("2026-06-01T11:30:00Z");
    const result = SolveDuration.between(start, end);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.minutes).toBe(90);
  });

  it("rounds a 45-second span up to one minute", () => {
    const start = new Date("2026-06-01T10:00:00Z");
    const end = new Date("2026-06-01T10:00:45Z");
    const result = SolveDuration.between(start, end);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.minutes).toBe(1);
  });

  it("rejects a zero-length span", () => {
    const instant = new Date("2026-06-01T10:00:00Z");
    const result = SolveDuration.between(instant, instant);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
  });

  it("rejects an end before start", () => {
    const start = new Date("2026-06-01T11:00:00Z");
    const end = new Date("2026-06-01T10:00:00Z");
    const result = SolveDuration.between(start, end);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDuration");
  });

  it("rehydrates a stored value via fromState", () => {
    expect(SolveDuration.fromState(42).minutes).toBe(42);
  });

  it("compares by minutes", () => {
    const thirty = SolveDuration.fromState(30);
    expect(thirty.equals(SolveDuration.fromState(30))).toBe(true);
    expect(thirty.equals(SolveDuration.fromState(31))).toBe(false);
  });
});

describe("isPlausibleSolveMinutes", () => {
  it("holds for what a solve can be stored with", () => {
    expect(isPlausibleSolveMinutes(1)).toBe(true);
    expect(isPlausibleSolveMinutes(90)).toBe(true);
    expect(isPlausibleSolveMinutes(MAX_SOLVE_MINUTES)).toBe(true);
  });

  it.each([
    0,
    -5,
    MAX_SOLVE_MINUTES + 1,
    Number.MAX_VALUE,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("refuses %p, whatever a row already holds", (minutes) => {
    expect(isPlausibleSolveMinutes(minutes)).toBe(false);
  });
});

describe("typedSolveMinutes", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const day = Date.UTC(2026, 9, 12);

  it("reads a time the member typed on a same-day solve", () => {
    expect(
      typedSolveMinutes({
        startDate: day,
        endDate: day,
        completionTimeMinutes: 200,
      }),
    ).toBe(200);
  });

  it("reads a time the member typed on a solve spanning several days", () => {
    expect(
      typedSolveMinutes({
        startDate: day,
        endDate: day + 3 * DAY_MS,
        completionTimeMinutes: 600,
      }),
    ).toBe(600);
  });

  it("does not take the one day stored for an untimed same-day solve for a time", () => {
    expect(
      typedSolveMinutes({
        startDate: day,
        endDate: day,
        completionTimeMinutes: 1440,
      }),
    ).toBeUndefined();
  });

  it("does not take a duration derived from the dates for a time", () => {
    expect(
      typedSolveMinutes({
        startDate: day,
        endDate: day + 3 * DAY_MS,
        completionTimeMinutes: 3 * 1440,
      }),
    ).toBeUndefined();
  });

  it("has no time for a solve that stored none", () => {
    expect(
      typedSolveMinutes({ startDate: day, endDate: day + DAY_MS }),
    ).toBeUndefined();
  });

  it("has no time for a year-only or undated solve", () => {
    for (const datePrecision of ["year", "unknown"] as const) {
      expect(
        typedSolveMinutes({
          startDate: day,
          endDate: day,
          completionTimeMinutes: 200,
          datePrecision,
        }),
      ).toBeUndefined();
    }
  });

  it("keeps a stored time on a row without an end date: it has no span to derive from", () => {
    expect(
      typedSolveMinutes({ startDate: day, completionTimeMinutes: 200 }),
    ).toBe(200);
  });

  it("has no time for a stored number no solve can have taken", () => {
    for (const completionTimeMinutes of [
      0,
      -5,
      MAX_SOLVE_MINUTES + 1,
      Number.MAX_VALUE,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        typedSolveMinutes({
          startDate: day,
          endDate: day + DAY_MS,
          completionTimeMinutes,
        }),
      ).toBeUndefined();
      expect(
        typedSolveMinutes({ startDate: day, completionTimeMinutes }),
      ).toBeUndefined();
    }
  });
});
