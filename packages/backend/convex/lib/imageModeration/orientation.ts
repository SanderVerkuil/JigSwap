// Turn a decoded RGBA bitmap upright for its Exif Orientation. Pure (no decoder, no Convex ctx).
//
// Exif Orientation n says how the stored pixels relate to the picture as it should be seen:
// 1 as stored, 2 mirrored left-right, 3 turned 180, 4 mirrored top-bottom, 5 transposed (mirrored
// along the top-left to bottom-right diagonal), 6 to be turned 90 clockwise, 7 transversed
// (mirrored along the other diagonal), 8 to be turned 90 counter-clockwise. 5..8 swap width and
// height.

export type Bitmap = { width: number; height: number; data: Uint8Array };

/** The upright copy of an RGBA bitmap stored with Exif Orientation 1..8. */
export const applyOrientation = (
  bitmap: Bitmap,
  orientation: number,
): Bitmap => {
  const { width: w, height: h, data } = bitmap;
  if (orientation < 2 || orientation > 8) return bitmap;
  const swap = orientation >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;
  // Where the stored pixel (x, y) lands in the upright image.
  const place: (x: number, y: number) => [number, number] = {
    2: (x: number, y: number): [number, number] => [w - 1 - x, y],
    3: (x: number, y: number): [number, number] => [w - 1 - x, h - 1 - y],
    4: (x: number, y: number): [number, number] => [x, h - 1 - y],
    5: (x: number, y: number): [number, number] => [y, x],
    6: (x: number, y: number): [number, number] => [h - 1 - y, x],
    7: (x: number, y: number): [number, number] => [h - 1 - y, w - 1 - x],
    8: (x: number, y: number): [number, number] => [y, w - 1 - x],
  }[orientation]!;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [u, v] = place(x, y);
      const from = (y * w + x) * 4;
      out.set(data.subarray(from, from + 4), (v * width + u) * 4);
    }
  }
  return { width, height, data: out };
};
