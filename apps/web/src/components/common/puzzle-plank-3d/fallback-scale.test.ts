import { describe, expect, it } from "vitest";
import { FALLBACK_OVERHANG, fallbackScale } from "./fallback-scale";

describe("fallbackScale", () => {
  it("leaves a plank that fits, overhang included, at full size", () => {
    expect(fallbackScale(1100, 590)).toBe(1);
    expect(fallbackScale(590 + 2 * FALLBACK_OVERHANG, 590)).toBe(1);
  });

  it("shrinks a plank wider than its container so nothing is cut", () => {
    // The review's phone case: a 444px plank in a 358px shelf.
    const scale = fallbackScale(358, 444);
    expect(scale).toBeLessThan(1);
    expect((444 + 2 * FALLBACK_OVERHANG) * scale).toBeCloseTo(358, 6);
  });

  it("stays at full size until both widths are measured", () => {
    expect(fallbackScale(0, 444)).toBe(1);
    expect(fallbackScale(358, 0)).toBe(1);
  });
});
