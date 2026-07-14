import { describe, expect, it } from "vitest";
import { SolveDuration } from "./solve-duration";

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
