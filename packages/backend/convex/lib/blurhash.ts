import { encode } from "blurhash";

// Blurhash placeholders for photos that are not (or no longer) shown in full: a photo still being
// screened (shown to other members as a blurred "pending review" tile) and, later, a removed
// message attachment. Pure and runtime-agnostic (no jimp, no Convex ctx), so any pipeline that has
// decoded an image can produce one and any read model can expose it.
//
// WHY 4x3 COMPONENTS: a blurhash is the first X*Y DCT coefficients of the image. 4x3 = 12
// coefficients: the average colour plus a few very low-frequency gradients (roughly "warm top-left,
// dark bottom"). It cannot carry edges, shapes, faces or text, so it does not reveal what an
// unscreened photo shows. More components sharpen it quickly (6x4+ starts to suggest silhouettes),
// so do not raise this for unscreened content. 4x3 is also blurhash's own recommended default and
// yields a fixed 28-character string.
export const BLURHASH_COMPONENTS = { x: 4, y: 3 } as const;

// The encoder only needs a thumbnail: the coefficients of a 32px-wide sample equal those of the
// full image to within rounding, at a fraction of the cost.
export const BLURHASH_SAMPLE_WIDTH = 32;

/** An RGBA pixel buffer (4 bytes per pixel, row-major), e.g. a decoded jimp bitmap. */
export interface RgbaBitmap {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** The sample size to scale an image to before encoding (aspect kept, at least 1px tall). */
export const blurhashSampleSize = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const sampleWidth = Math.min(BLURHASH_SAMPLE_WIDTH, Math.max(1, width));
  return {
    width: sampleWidth,
    height: Math.max(
      1,
      Math.round((height * sampleWidth) / Math.max(1, width)),
    ),
  };
};

/** Encode an RGBA bitmap (ideally already scaled by {@link blurhashSampleSize}) as a blurhash. */
export const encodeBlurhash = (bitmap: RgbaBitmap): string =>
  encode(
    new Uint8ClampedArray(
      bitmap.data.buffer,
      bitmap.data.byteOffset,
      bitmap.width * bitmap.height * 4,
    ),
    bitmap.width,
    bitmap.height,
    BLURHASH_COMPONENTS.x,
    BLURHASH_COMPONENTS.y,
  );
