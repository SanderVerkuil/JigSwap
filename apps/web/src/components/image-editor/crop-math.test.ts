import { describe, expect, it } from "vitest";
import { rotateSize } from "./crop-math";

describe("rotateSize", () => {
  it("is the identity at 0° and 180°", () => {
    expect(rotateSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
    const r180 = rotateSize(400, 300, 180);
    expect(r180.width).toBeCloseTo(400);
    expect(r180.height).toBeCloseTo(300);
  });

  it("swaps dimensions at 90° and 270°", () => {
    const r90 = rotateSize(400, 300, 90);
    expect(r90.width).toBeCloseTo(300);
    expect(r90.height).toBeCloseTo(400);
    const r270 = rotateSize(400, 300, 270);
    expect(r270.width).toBeCloseTo(300);
    expect(r270.height).toBeCloseTo(400);
  });

  it("bounds a 45° rotation by the diagonal", () => {
    const r45 = rotateSize(100, 100, 45);
    expect(r45.width).toBeCloseTo(Math.SQRT2 * 100);
    expect(r45.height).toBeCloseTo(Math.SQRT2 * 100);
  });
});
