import type { PixelArea } from "./crop-math";

// A percent-based crop selection (react-image-crop's `unit: "%"` shape, 0-100 per axis).
export interface PercentCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Full-image selection — the dialog's initial crop, so rotate-only edits work without dragging.
export const fullCrop = (): PercentCrop => ({
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});

// Map a percent selection on the (rotated) preview to pixel coordinates in the rotated
// canvas space that bakeImage cuts from. An empty/zero selection falls back to the full frame.
export const percentCropToPixelArea = (
  crop: PercentCrop,
  rotatedWidth: number,
  rotatedHeight: number,
): PixelArea => {
  const effective = crop.width > 0 && crop.height > 0 ? crop : fullCrop();
  return {
    x: (effective.x / 100) * rotatedWidth,
    y: (effective.y / 100) * rotatedHeight,
    width: (effective.width / 100) * rotatedWidth,
    height: (effective.height / 100) * rotatedHeight,
  };
};
