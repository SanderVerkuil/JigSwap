// Pure geometry for the image editor's canvas bake. Kept canvas-free so the web test
// suite (node environment) can pin it; the browser-only drawing lives in bake-image.ts.

export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Bounding-box size of a w×h rectangle rotated by `rotationDeg` degrees.
export const rotateSize = (
  width: number,
  height: number,
  rotationDeg: number,
): { width: number; height: number } => {
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
};

// react-easy-crop reports fractional pixel areas that can poke past the rotated canvas
// by sub-pixels; clamp to integer bounds so drawImage/toBlob never sample outside.
export const clampCropArea = (
  area: PixelArea,
  canvasWidth: number,
  canvasHeight: number,
): PixelArea => {
  const x = Math.min(Math.max(Math.floor(area.x), 0), canvasWidth);
  const y = Math.min(Math.max(Math.floor(area.y), 0), canvasHeight);
  return {
    x,
    y,
    width: Math.min(Math.floor(area.width), canvasWidth - x),
    height: Math.min(Math.floor(area.height), canvasHeight - y),
  };
};
