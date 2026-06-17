import { type PlankBox } from "@/components/marketing/plank";
import type { PlankPuzzle } from "@/components/marketing/variants/use-landing-data";

import coverSand from "@/components/marketing/assets/cover-sand.webp";

// Plank data helpers for the editorial hero cover. Mirrors the mapping logic in
// home/hero.tsx (toPlankBox / toRows) so the cropped plank reads the same real
// catalog data — we never re-fetch Convex here, the entry passes plankPuzzles in.

const WIDTHS = [100, 134, 96, 108, 90, 104, 98] as const;
const COLOR_PAIRS: Array<[string, string]> = [
  ["var(--mk-violet-400)", "var(--mk-violet-600)"],
  ["var(--mk-green-400)", "var(--mk-green-600)"],
  ["var(--mk-pink-400)", "var(--mk-pink-500)"],
  ["var(--mk-violet-300)", "var(--mk-violet-700)"],
];

const SHELF_ROWS = 5;

// Loading / sparse-catalog fallback boxes (decorative; one real cover).
export const PLANK_WIDE: PlankBox[] = [
  {
    series: "Natuur",
    title: "Boslicht",
    pieceCount: 1000,
    c1: "var(--mk-violet-400)",
    c2: "var(--mk-violet-600)",
    width: 100,
  },
  {
    series: "Steden",
    title: "Amsterdam",
    pieceCount: 1500,
    c1: "var(--mk-green-400)",
    c2: "var(--mk-green-600)",
    width: 96,
  },
  { cover: coverSand, title: "Zandsculpturen", width: 134 },
  {
    series: "Kunst",
    title: "Sterrennacht",
    pieceCount: 2000,
    c1: "var(--mk-pink-400)",
    c2: "var(--mk-pink-500)",
    width: 108,
  },
  {
    series: "Natuur",
    title: "Waddenzee",
    pieceCount: 500,
    c1: "var(--mk-green-300)",
    c2: "var(--mk-green-600)",
    width: 90,
  },
  {
    series: "Steden",
    title: "Rotterdam",
    pieceCount: 1000,
    c1: "var(--mk-violet-300)",
    c2: "var(--mk-violet-700)",
    width: 104,
  },
  {
    series: "Kunst",
    title: "De Melkmeid",
    pieceCount: 1500,
    c1: "var(--mk-pink-300)",
    c2: "var(--mk-pink-500)",
    width: 98,
  },
  {
    series: "Natuur",
    title: "Keukenhof",
    pieceCount: 1000,
    c1: "var(--mk-green-400)",
    c2: "var(--mk-green-600)",
    width: 112,
  },
  {
    series: "Steden",
    title: "Utrecht",
    pieceCount: 750,
    c1: "var(--mk-violet-400)",
    c2: "var(--mk-violet-600)",
    width: 94,
  },
  {
    series: "Kunst",
    title: "De Nachtwacht",
    pieceCount: 2000,
    c1: "var(--mk-pink-400)",
    c2: "var(--mk-pink-500)",
    width: 118,
  },
];

export function toPlankBox(p: PlankPuzzle, i: number): PlankBox {
  const [c1, c2] = COLOR_PAIRS[i % COLOR_PAIRS.length];
  return {
    title: p.title,
    pieceCount: p.pieceCount,
    series: p.brand,
    cover: p.image ?? undefined,
    width: WIDTHS[i % WIDTHS.length],
    c1,
    c2,
  };
}

export function toRows(boxes: PlankBox[]): PlankBox[][] {
  const rows: PlankBox[][] = Array.from({ length: SHELF_ROWS }, () => []);
  boxes.forEach((box, i) => rows[i % SHELF_ROWS].push(box));
  return rows;
}
