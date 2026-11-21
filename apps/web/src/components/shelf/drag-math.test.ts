import { describe, expect, it } from "vitest";
import { clampThrowVelocity, MAX_THROW_SPEED } from "./drag-math";

describe("clampThrowVelocity", () => {
  it("passes through a slow throw unchanged", () => {
    expect(clampThrowVelocity([1, 0, -1])).toEqual([1, 0, -1]);
  });
  it("scales an over-fast throw down to MAX_THROW_SPEED, preserving direction", () => {
    const v = clampThrowVelocity([0, 0, -100]);
    expect(Math.hypot(...v)).toBeCloseTo(MAX_THROW_SPEED, 5);
    expect(v[2]).toBeLessThan(0); // same direction
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(0);
  });
  it("returns zero for a zero vector (no divide-by-zero)", () => {
    expect(clampThrowVelocity([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
