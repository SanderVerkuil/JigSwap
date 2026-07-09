// Border-trim detection for the image editor's "Auto crop": given RGBA pixel data
// (ImageData.data layout), find the bounding box of CONTENT — pixels that are not
// background. Background = (nearly) transparent, near-white, near-black, or within
// `fuzz` of a reference color sampled from the image corners (ImageMagick
// `-trim -fuzz` style). The corner references absorb real-photo lighting gradients,
// where the side away from the light sits well below the absolute white threshold.
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
  fuzz: number; // max per-channel distance from a corner reference to count as background (default 24)
}

export interface BackgroundReference {
  r: number;
  g: number;
  b: number;
}

const DEFAULT_OPTIONS: AutoCropOptions = {
  alphaThreshold: 8,
  whiteThreshold: 245,
  blackThreshold: 10,
  noiseFraction: 0.005,
  fuzz: 24,
};

export const isBackgroundPixel = (
  r: number,
  g: number,
  b: number,
  a: number,
  opts: AutoCropOptions,
  references: readonly BackgroundReference[] = [],
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
  for (const ref of references) {
    if (
      Math.abs(r - ref.r) <= opts.fuzz &&
      Math.abs(g - ref.g) <= opts.fuzz &&
      Math.abs(b - ref.b) <= opts.fuzz
    )
      return true;
  }
  return false;
};

// A corner only becomes a background reference when it already looks like a photo
// background on its own: near-neutral light gray (dim white under uneven lighting)
// or near-black. Saturated/mid-tone corners mean the photo fills the frame — no
// reference, so nothing beyond the absolute thresholds gets trimmed.
const isReferenceCandidate = (ref: BackgroundReference): boolean => {
  const max = Math.max(ref.r, ref.g, ref.b);
  const min = Math.min(ref.r, ref.g, ref.b);
  const neutralLight = min >= 180 && max - min <= 24;
  const nearBlack = max <= 40;
  return neutralLight || nearBlack;
};

// Average an n×n patch anchored at (x0, y0); opaque pixels only. Returns null when
// the patch is fully transparent — transparency is already background.
const samplePatch = (
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  patch: number,
  alphaThreshold: number,
): BackgroundReference | null => {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = y0; y < y0 + patch; y++) {
    for (let x = x0; x < x0 + patch; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < alphaThreshold) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  if (count === 0) return null;
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
};

const cornerReferences = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: AutoCropOptions,
): BackgroundReference[] => {
  const patch = Math.max(1, Math.min(3, width, height));
  const corners: Array<[number, number]> = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  const references: BackgroundReference[] = [];
  for (const [x0, y0] of corners) {
    const ref = samplePatch(data, width, x0, y0, patch, opts.alphaThreshold);
    if (ref && isReferenceCandidate(ref)) references.push(ref);
  }
  return references;
};

export const contentBoundingBox = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: Partial<AutoCropOptions>,
): PixelArea | null => {
  const opts: AutoCropOptions = { ...DEFAULT_OPTIONS, ...options };
  const references = cornerReferences(data, width, height, opts);

  const colCounts = new Uint32Array(width);
  const rowCounts = new Uint32Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (!isBackgroundPixel(r, g, b, a, opts, references)) {
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
