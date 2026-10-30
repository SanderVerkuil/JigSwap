import type { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import { BOX_SCALE, PX } from "@/components/marketing/plank-3d/box";

/** World-space gap between neighbouring boxes on the shelf row. */
export const GAP = 0.12;

// Headroom added above the tallest box when computing the framed height. Kept
// generous so the gentle downward camera tilt never clips the top of a tall
// (portrait) cover.
export const CONTENT_HEADROOM = 0.6;
// Minimum visible world width so a 1-2 box row isn't hugely zoomed.
export const MIN_VIS_W = 2.0;
// World width kept free beside the row (split over both ends) so the outer
// covers, their nearer front faces and the parallax sway stay in frame.
export const ROW_SIDE_MARGIN = 0.3;

export interface RowSlot {
  /** World-space x of the box center. */
  x: number;
}

export interface RowLayout {
  slots: RowSlot[];
  /** Total world width spanned by the boxes + gaps. */
  rowWidth: number;
}

/** World width of one box from its CSS-pixel width (matches box.tsx scaling). */
function boxWorldWidth(box: PuzzlePlankBox): number {
  return (box.width ?? 116) * PX * BOX_SCALE;
}

/**
 * Lay boxes out in a single row, centered on x=0, left→right in list order,
 * separated by GAP. Deterministic; no randomness. Pure.
 */
export function layoutRow(boxes: PuzzlePlankBox[]): RowLayout {
  if (boxes.length === 0) return { slots: [], rowWidth: 0 };
  const widths = boxes.map(boxWorldWidth);
  const rowWidth = widths.reduce((a, b) => a + b, 0) + GAP * (boxes.length - 1);
  const slots: RowSlot[] = [];
  let cursor = -rowWidth / 2;
  for (const wb of widths) {
    slots.push({ x: cursor + wb / 2 });
    cursor += wb + GAP;
  }
  return { slots, rowWidth };
}

/**
 * World height the camera must frame so the whole shelf row is visible on a
 * canvas of the given aspect (width / height): the tallest box plus headroom,
 * the row plus its side margin (on near-square phone and tablet canvases the
 * width binds), and never less than MIN_VIS_W across. Pure.
 */
export function framedContentHeight({
  maxBoxH,
  rowWidth,
  aspect,
}: {
  maxBoxH: number;
  rowWidth: number;
  aspect: number;
}): number {
  return Math.max(
    maxBoxH + CONTENT_HEADROOM,
    (rowWidth + ROW_SIDE_MARGIN) / aspect,
    MIN_VIS_W / aspect,
  );
}
