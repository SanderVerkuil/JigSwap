import { describe, expect, it } from "vitest";
import {
  fallbackCentringShift,
  fallbackHeight,
  fallbackScale,
} from "./fallback-scale";

// What the plank paints past its layout box: 16px on the left, 58px on the right.
const OVERHANG = 16 + 58;

describe("fallbackScale", () => {
  it("leaves a plank that fits, overhang included, at full size", () => {
    expect(fallbackScale(1100, 590)).toBe(1);
    expect(fallbackScale(590 + OVERHANG, 590)).toBe(1);
  });

  it("shrinks a plank wider than its container so nothing is cut", () => {
    // A phone's three boxes: a 444px plank in a 358px shelf.
    const scale = fallbackScale(358, 444);
    expect(scale).toBeLessThan(1);
    expect((444 + OVERHANG) * scale).toBeCloseTo(358, 6);
  });

  it("stays at full size until both widths are measured", () => {
    expect(fallbackScale(0, 444)).toBe(1);
    expect(fallbackScale(358, 0)).toBe(1);
  });
});

describe("fallbackCentringShift", () => {
  it("moves the plank by half what its right side paints more than its left", () => {
    expect(fallbackCentringShift(1)).toBe(21);
    expect(fallbackCentringShift(0.5)).toBe(10.5);
  });

  it("centres what is painted: equal room on both sides at any scale", () => {
    const container = 358;
    const plank = 444;
    const scale = fallbackScale(container, plank);
    const left =
      container / 2 - (plank / 2 + 16) * scale - fallbackCentringShift(scale);
    const right =
      container / 2 + (plank / 2 + 58) * scale - fallbackCentringShift(scale);
    expect(left).toBeCloseTo(container - right, 6);
    expect(left).toBeCloseTo(0, 6);
  });
});

describe("fallbackHeight", () => {
  it("follows the scaled plank, overhang included", () => {
    expect(fallbackHeight(84, 1)).toBe(128);
    expect(fallbackHeight(84, 0.5)).toBe(64);
  });
});
