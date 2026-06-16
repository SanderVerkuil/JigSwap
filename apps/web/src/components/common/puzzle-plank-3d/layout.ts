import type { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import { BOX_SCALE, PX } from "@/components/marketing/plank-3d/box";

/** World-space gap between neighbouring boxes on the shelf row. */
export const GAP = 0.12;

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
