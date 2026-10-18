import { decode, isBlurhashValid } from "blurhash";
import { describe, expect, test } from "vitest";
import {
  BLURHASH_COMPONENTS,
  blurhashSampleSize,
  encodeBlurhash,
} from "./lib/blurhash";

// The placeholder for an unscreened photo must not reveal it. These tests pin the component count
// and show that a 4x3 blurhash keeps only coarse colour, not detail.

const bitmap = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
};

describe("encodeBlurhash", () => {
  test("uses 4x3 components: a valid 28-character hash with size flag L", () => {
    expect(BLURHASH_COMPONENTS).toEqual({ x: 4, y: 3 });
    const hash = encodeBlurhash(bitmap(32, 24, (x, y) => [x * 8, y * 10, 128]));
    expect(isBlurhashValid(hash).result).toBe(true);
    // Size flag = (x-1) + (y-1)*9 = 21 => base83 "L"; length 4 + 2*(x*y-1) = 28.
    expect(hash).toHaveLength(28);
    expect(hash[0]).toBe("L");
  });

  test("fine detail does not survive: a 2px checkerboard decodes to a near-flat grey", () => {
    const checker = bitmap(32, 32, (x, y) =>
      (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0
        ? [0, 0, 0]
        : [255, 255, 255],
    );
    const pixels = decode(encodeBlurhash(checker), 32, 32);
    let min = 255;
    let max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      min = Math.min(min, pixels[i]);
      max = Math.max(max, pixels[i]);
    }
    // The source spans 0..255; the placeholder stays within a narrow band around mid grey.
    expect(max - min).toBeLessThan(40);
  });

  test("coarse colour survives: a red-left / blue-right image stays red-left / blue-right", () => {
    const split = bitmap(32, 24, (x) =>
      x < 16 ? [220, 30, 30] : [30, 30, 220],
    );
    const pixels = decode(encodeBlurhash(split), 32, 24);
    const at = (x: number, y: number) =>
      pixels.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 3);
    const left = at(2, 12);
    const right = at(29, 12);
    expect(left[0]).toBeGreaterThan(left[2]);
    expect(right[2]).toBeGreaterThan(right[0]);
  });
});

describe("blurhashSampleSize", () => {
  test("scales to 32px wide, keeps the aspect ratio, never 0px", () => {
    expect(blurhashSampleSize(4000, 3000)).toEqual({ width: 32, height: 24 });
    expect(blurhashSampleSize(16, 8)).toEqual({ width: 16, height: 8 });
    expect(blurhashSampleSize(3000, 10)).toEqual({ width: 32, height: 1 });
  });
});
