// Pure geometry for the image editor. Kept canvas-free so the web test suite (node
// environment) can pin it.

// Bounding-box size of a w×h rectangle rotated by `rotationDeg` degrees. Used by
// auto-crop to replicate, at analysis time, the same rotated-bounding-canvas space that
// react-advanced-cropper's stencil coordinates live in.
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
