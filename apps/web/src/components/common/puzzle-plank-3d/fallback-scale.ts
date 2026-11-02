import { fitScale } from "@/components/marketing/fit-to-width";

// Kept apart from layout.ts so the CSS fallback never pulls three.js into the
// page bundle (layout.ts imports the 3D box module).

/**
 * How far the CSS plank (default depth) paints past its layout box. On the left
 * only the shelf's 16px past the boxes; on the right its end cap and receding
 * top add 42px more.
 */
const OVERHANG_LEFT = 16;
const OVERHANG_RIGHT = 58;

/**
 * The same above and below, plus some of the shelf's cast shadow: the boxes sit
 * 17px up and back, and the shelf's 16px lip and its shadow hang below.
 */
const OVERHANG_Y = 44;

/**
 * Scale for the CSS fallback plank so the whole shelf, overhang included, fits
 * its container: never enlarged, and left at 1 until both widths are measured.
 * Pure.
 */
export function fallbackScale(containerW: number, plankW: number): number {
  if (plankW <= 0) return 1;
  return fitScale(containerW, plankW + OVERHANG_LEFT + OVERHANG_RIGHT);
}

/**
 * How far left to move a plank scaled by `scale` so what it paints, not just its
 * layout box, sits in the middle of its container.
 */
export function fallbackCentringShift(scale: number): number {
  return ((OVERHANG_RIGHT - OVERHANG_LEFT) / 2) * scale;
}

/** The height the plank paints at `scale`: what a container sized to it needs. Pure. */
export function fallbackHeight(plankH: number, scale: number): number {
  return Math.ceil((plankH + OVERHANG_Y) * scale);
}
