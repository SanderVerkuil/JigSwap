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
});
