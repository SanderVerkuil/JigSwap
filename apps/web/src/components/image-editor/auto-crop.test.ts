import { describe, expect, it } from "vitest";
import { contentBoundingBox, isBackgroundPixel } from "./auto-crop";

// Builds a width×height RGBA array (ImageData.data layout) from a painter callback that
// returns [r,g,b,a] for each pixel coordinate.
const paint = (
  width: number,
  height: number,
  painter: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = painter(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
};

const isInBlock = (
  x: number,
  y: number,
  block: { x: number; y: number; width: number; height: number },
) =>
  x >= block.x &&
  x < block.x + block.width &&
  y >= block.y &&
  y < block.y + block.height;

describe("isBackgroundPixel", () => {
  const opts = {
    alphaThreshold: 8,
    whiteThreshold: 245,
    blackThreshold: 10,
    noiseFraction: 0.005,
    fuzz: 24,
  };

  it("treats nearly-transparent pixels as background", () => {
    expect(isBackgroundPixel(200, 100, 50, 0, opts)).toBe(true);
    expect(isBackgroundPixel(200, 100, 50, 7, opts)).toBe(true);
  });

  it("treats near-white pixels as background", () => {
    expect(isBackgroundPixel(255, 255, 255, 255, opts)).toBe(true);
    expect(isBackgroundPixel(246, 250, 245, 255, opts)).toBe(true);
  });

  it("treats near-black pixels as background", () => {
    expect(isBackgroundPixel(0, 0, 0, 255, opts)).toBe(true);
    expect(isBackgroundPixel(10, 5, 3, 255, opts)).toBe(true);
  });

  it("treats mid-tone opaque pixels as content", () => {
    expect(isBackgroundPixel(255, 0, 0, 255, opts)).toBe(false);
    expect(isBackgroundPixel(128, 128, 128, 255, opts)).toBe(false);
  });

  it("treats pixels within fuzz of a background reference as background", () => {
    const references = [{ r: 240, g: 240, b: 240 }];
    // 235 is below whiteThreshold, but within fuzz of the sampled reference.
    expect(isBackgroundPixel(235, 236, 238, 255, opts, references)).toBe(true);
    // Saturated content stays content even with a reference present.
    expect(isBackgroundPixel(180, 60, 60, 255, opts, references)).toBe(false);
    // Outside the fuzz distance from the reference.
    expect(isBackgroundPixel(210, 210, 210, 255, opts, references)).toBe(false);
  });
});

describe("contentBoundingBox", () => {
  it("finds a red block on a white background", () => {
    const block = { x: 3, y: 3, width: 4, height: 4 };
    const data = paint(10, 10, (x, y) =>
      isInBlock(x, y, block) ? [255, 0, 0, 255] : [255, 255, 255, 255],
    );
    expect(contentBoundingBox(data, 10, 10)).toEqual(block);
  });

  it("finds the same block on a transparent background", () => {
    const block = { x: 3, y: 3, width: 4, height: 4 };
    const data = paint(10, 10, (x, y) =>
      isInBlock(x, y, block) ? [255, 0, 0, 255] : [0, 0, 0, 0],
    );
    expect(contentBoundingBox(data, 10, 10)).toEqual(block);
  });

  it("finds the same block on a black background", () => {
    const block = { x: 3, y: 3, width: 4, height: 4 };
    const data = paint(10, 10, (x, y) =>
      isInBlock(x, y, block) ? [255, 0, 0, 255] : [0, 0, 0, 255],
    );
    expect(contentBoundingBox(data, 10, 10)).toEqual(block);
  });

  it("returns null for an all-white image (no content)", () => {
    const data = paint(10, 10, () => [255, 255, 255, 255]);
    expect(contentBoundingBox(data, 10, 10)).toBeNull();
  });

  it("returns null when content touches all four edges (nothing to trim)", () => {
    const data = paint(10, 10, (x, y) =>
      x === 0 || y === 0 || x === 9 || y === 9
        ? [255, 0, 0, 255]
        : [255, 255, 255, 255],
    );
    expect(contentBoundingBox(data, 10, 10)).toBeNull();
  });

  it("ignores a stray noise pixel below the noise fraction while still detecting the block", () => {
    const block = { x: 3, y: 3, width: 4, height: 4 };
    const data = paint(10, 10, (x, y) => {
      if (isInBlock(x, y, block)) return [255, 0, 0, 255];
      // Stray red pixel in column 0, well outside the block — 1 of 10 pixels in that
      // column (10%), below the 15% noiseFraction configured for this test.
      if (x === 0 && y === 0) return [255, 0, 0, 255];
      return [255, 255, 255, 255];
    });
    expect(contentBoundingBox(data, 10, 10, { noiseFraction: 0.15 })).toEqual(
      block,
    );
  });

  it("finds a non-square block in a non-square frame (axes not interchangeable)", () => {
    const block = { x: 2, y: 1, width: 3, height: 4 };
    const data = paint(12, 8, (x, y) =>
      isInBlock(x, y, block) ? [255, 0, 0, 255] : [255, 255, 255, 255],
    );
    expect(contentBoundingBox(data, 12, 8)).toEqual(block);
  });

  it("detects a mid-gray block on a white background (gray is content, not background)", () => {
    const block = { x: 2, y: 2, width: 5, height: 3 };
    const data = paint(10, 10, (x, y) =>
      isInBlock(x, y, block) ? [128, 128, 128, 255] : [255, 255, 255, 255],
    );
    expect(contentBoundingBox(data, 10, 10)).toEqual(block);
  });

  it("trims a white background with a lighting gradient on all four sides", () => {
    // Real photo backgrounds are rarely uniform white: the side away from the
    // light sits below whiteThreshold (245). Background luminance here runs
    // 230 at the top-left corner up to 252 at the bottom-right — the top/left
    // half fails the absolute white test but matches the sampled corner
    // reference within fuzz.
    const block = { x: 4, y: 4, width: 4, height: 4 };
    const data = paint(12, 12, (x, y) => {
      if (isInBlock(x, y, block)) return [200, 30, 30, 255];
      const v = 230 + x + y > 255 ? 255 : 230 + x + y;
      return [v, v, v, 255];
    });
    expect(contentBoundingBox(data, 12, 12)).toEqual(block);
  });

  it("does not treat a colored background as trimmable via corner sampling", () => {
    // Corner references only activate for background-like corners (near-neutral
    // light, near-black, or transparent). A saturated blue frame stays content,
    // so nothing is trimmed even though every corner has a consistent color.
    const block = { x: 3, y: 3, width: 4, height: 4 };
    const data = paint(10, 10, (x, y) =>
      isInBlock(x, y, block) ? [200, 30, 30, 255] : [40, 60, 200, 255],
    );
    expect(contentBoundingBox(data, 10, 10)).toBeNull();
  });

  it("trims a near-black background darker than pure black threshold via corner sampling", () => {
    // A dim photo background (e.g. 25,25,25) is above blackThreshold(10) but
    // should still be trimmed once the corners establish it as the background.
    const block = { x: 3, y: 3, width: 4, height: 4 };
    const data = paint(10, 10, (x, y) =>
      isInBlock(x, y, block) ? [200, 30, 30, 255] : [25, 25, 25, 255],
    );
    expect(contentBoundingBox(data, 10, 10)).toEqual(block);
  });
});
