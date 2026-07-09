import { describe, expect, it } from "vitest";
import { fullCrop, percentCropToPixelArea } from "./crop-select";

describe("fullCrop", () => {
  it("is the full 0-100 frame on both axes", () => {
    expect(fullCrop()).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("percentCropToPixelArea", () => {
  it("maps the full frame (0/100) to the entire rotated canvas", () => {
    expect(percentCropToPixelArea(fullCrop(), 400, 300)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("maps a 25%-square selection to exact pixels for a 400x300 rotated frame", () => {
    expect(
      percentCropToPixelArea({ x: 10, y: 20, width: 25, height: 25 }, 400, 300),
    ).toEqual({
      x: 40,
      y: 60,
      width: 100,
      height: 75,
    });
  });

  it("falls back to the full frame for a zero-size selection", () => {
    expect(
      percentCropToPixelArea({ x: 50, y: 50, width: 0, height: 0 }, 400, 300),
    ).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("produces proportional, unrounded pixels for fractional percents", () => {
    const result = percentCropToPixelArea(
      { x: 12.5, y: 33.333, width: 10.1, height: 5.25 },
      400,
      300,
    );
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(99.999);
    expect(result.width).toBeCloseTo(40.4);
    expect(result.height).toBeCloseTo(15.75);
    // Not integer-rounded — clampCropArea (bakeImage) owns rounding, not this helper.
    expect(Number.isInteger(result.width)).toBe(false);
  });
});
