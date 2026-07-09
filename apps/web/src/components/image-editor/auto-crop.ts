// Border-trim detection for the image editor's "Auto crop": given RGBA pixel data
// (ImageData.data layout), find the bounding box of CONTENT — pixels that are not
// background, where background = (nearly) transparent, near-white, or near-black.
// Returns null when there is no content or nothing would be trimmed.

export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutoCropOptions {
  alphaThreshold: number; // a < this ⇒ background (default 8)
  whiteThreshold: number; // r,g,b all >= this ⇒ background (default 245)
  blackThreshold: number; // r,g,b all <= this ⇒ background (default 10)
  noiseFraction: number; // a row/col is content when > this fraction of its pixels are content (default 0.005)
}

const DEFAULT_OPTIONS: AutoCropOptions = {
  alphaThreshold: 8,
  whiteThreshold: 245,
  blackThreshold: 10,
  noiseFraction: 0.005,
};

export const isBackgroundPixel = (
  r: number,
  g: number,
  b: number,
  a: number,
  opts: AutoCropOptions,
): boolean => {
  if (a < opts.alphaThreshold) return true;
  if (
    r >= opts.whiteThreshold &&
    g >= opts.whiteThreshold &&
    b >= opts.whiteThreshold
  )
    return true;
  if (
    r <= opts.blackThreshold &&
    g <= opts.blackThreshold &&
    b <= opts.blackThreshold
  )
    return true;
  return false;
};

export const contentBoundingBox = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: Partial<AutoCropOptions>,
): PixelArea | null => {
  const opts: AutoCropOptions = { ...DEFAULT_OPTIONS, ...options };

  const colCounts = new Uint32Array(width);
  const rowCounts = new Uint32Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (!isBackgroundPixel(r, g, b, a, opts)) {
        colCounts[x]++;
        rowCounts[y]++;
      }
    }
  }

  const colThreshold = opts.noiseFraction * height;
  const rowThreshold = opts.noiseFraction * width;

  let left = -1;
  for (let x = 0; x < width; x++) {
    if (colCounts[x] > colThreshold) {
      left = x;
      break;
    }
  }
  if (left === -1) return null; // no content column found

  let right = width - 1;
  for (let x = width - 1; x >= 0; x--) {
    if (colCounts[x] > colThreshold) {
      right = x;
      break;
    }
  }

  let top = -1;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] > rowThreshold) {
      top = y;
      break;
    }
  }
  if (top === -1) return null; // no content row found

  let bottom = height - 1;
  for (let y = height - 1; y >= 0; y--) {
    if (rowCounts[y] > rowThreshold) {
      bottom = y;
      break;
    }
  }

  const bboxWidth = right - left + 1;
  const bboxHeight = bottom - top + 1;
  if (left === 0 && top === 0 && bboxWidth === width && bboxHeight === height) {
    return null; // nothing to trim
  }

  return { x: left, y: top, width: bboxWidth, height: bboxHeight };
};
