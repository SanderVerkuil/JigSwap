import { describe, expect, it } from "vitest";
import { wipePercentFromPointer } from "./image-compare";

describe("wipePercentFromPointer", () => {
  it("returns 50 at the center of the rect", () => {
    expect(wipePercentFromPointer(150, 100, 100)).toBe(50);
  });

  it("clamps to 0 at and beyond the left edge", () => {
    expect(wipePercentFromPointer(100, 100, 100)).toBe(0);
    expect(wipePercentFromPointer(50, 100, 100)).toBe(0);
  });

  it("clamps to 100 at and beyond the right edge", () => {
    expect(wipePercentFromPointer(200, 100, 100)).toBe(100);
    expect(wipePercentFromPointer(250, 100, 100)).toBe(100);
  });

  it("returns a proportional value for interior points", () => {
    expect(wipePercentFromPointer(125, 100, 100)).toBe(25);
  });

  it("returns 50 for a degenerate zero-width rect", () => {
    expect(wipePercentFromPointer(120, 100, 0)).toBe(50);
  });
});
