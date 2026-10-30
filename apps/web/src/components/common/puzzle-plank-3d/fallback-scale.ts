import { fitScale } from "@/components/marketing/fit-to-width";

// Kept apart from layout.ts so the CSS fallback never pulls three.js into the
// page bundle (layout.ts imports the 3D box module).

/**
 * How far the CSS plank (default depth) paints past its layout box on its wider
 * side: the shelf runs 16px past the boxes and its end cap and receding top add
 * 42px more on the right. Reserved on both sides because the plank is centred.
 */
export const FALLBACK_OVERHANG = 58;

/**
 * Scale for the CSS fallback plank so the whole shelf, overhang included, fits
 * its container: never enlarged, and left at 1 until both widths are measured.
 * Pure.
 */
export function fallbackScale(containerW: number, plankW: number): number {
  if (plankW <= 0) return 1;
  return fitScale(containerW, plankW + 2 * FALLBACK_OVERHANG);
}
