import type { PlankBox } from "@/components/marketing/plank";

// Canvas pixels per CSS-plank pixel. The plank-3d front faces render at
// roughly 1.5-2x the CSS size on screen; 4x keeps text crisp at dpr 2.
export const ART_SCALE = 4;

export interface BoxArtSpec {
  /** Canvas dimensions in device pixels (already scaled by ART_SCALE). */
  width: number;
  height: number;
  mode: "cover" | "gradient";
  coverSrc?: string;
  /** Resolved hex colors — never raw var()/color-mix() strings. */
  c1: string;
  c2: string;
  series?: string;
  title?: string;
  pieceCount?: number;
}

export function buildBoxArtSpec(
  box: PlankBox,
  resolved: { c1: string; c2: string },
  heightPx: number,
): BoxArtSpec {
  const widthPx = box.width ?? 116;
  return {
    width: widthPx * ART_SCALE,
    height: heightPx * ART_SCALE,
    mode: box.cover ? "cover" : "gradient",
    coverSrc: box.cover,
    c1: resolved.c1,
    c2: resolved.c2,
    series: box.series,
    title: box.title,
    pieceCount: box.pieceCount,
  };
}
