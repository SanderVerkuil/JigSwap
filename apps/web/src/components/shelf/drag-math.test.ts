import { describe, expect, it } from "vitest";
import {
  clampThrowVelocity,
  MAX_THROW_SPEED,
  releaseVelocity,
  THROW_MAX_PAUSE_MS,
} from "./drag-math";

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

describe("releaseVelocity", () => {
  const at = (x: number, t: number) => ({ p: { x, y: 0, z: 0 }, t });
  const moving = [at(0, 1000), at(0.05, 1016)];

  it("throws at the last two samples' speed when released while moving", () => {
    const v = releaseVelocity(moving, 1020);
    expect(v[0]).toBeCloseTo(3.125, 5);
    expect(v[1]).toBe(0);
    expect(v[2]).toBe(0);
  });
  it("still throws exactly THROW_MAX_PAUSE_MS after the last sample", () => {
    expect(
      releaseVelocity(moving, 1016 + THROW_MAX_PAUSE_MS)[0],
    ).toBeGreaterThan(0);
  });
  it("drops the box 1 ms later", () => {
    expect(releaseVelocity(moving, 1016 + THROW_MAX_PAUSE_MS + 1)).toEqual([
      0, 0, 0,
    ]);
  });
  it("drops with fewer than two samples", () => {
    expect(releaseVelocity([], 0)).toEqual([0, 0, 0]);
    expect(releaseVelocity([at(0, 0)], 1)).toEqual([0, 0, 0]);
  });
  it("drops when the last two samples share a timestamp", () => {
    expect(releaseVelocity([at(0, 5), at(1, 5)], 6)).toEqual([0, 0, 0]);
  });
  it("caps a flick faster than MAX_THROW_SPEED", () => {
    const v = releaseVelocity([at(0, 0), at(10, 10)], 10);
    expect(Math.hypot(...v)).toBeCloseTo(MAX_THROW_SPEED, 5);
  });
});
