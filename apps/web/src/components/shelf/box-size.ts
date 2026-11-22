import type * as React from "react";

// How wide a box stands on a shelf, as a share of a 1,000-piece box: bigger puzzles come in bigger
// boxes, so a row reads as real boxes. The 500 and 2,000 steps are the home hero drawer's (68% and
// 100% of its column, where 1,000 is 85%). An unknown count stands as 1,000.
export function boxScale(pieceCount?: number): number {
  if (pieceCount === undefined || pieceCount <= 0) return 1;
  if (pieceCount <= 300) return 0.72;
  if (pieceCount <= 500) return 0.8;
  if (pieceCount <= 1000) return 1;
  if (pieceCount <= 1500) return 1.09;
  if (pieceCount <= 2000) return 1.18;
  return 1.26;
}

// The gap between two boxes on a row, in px.
const SHELF_GAP = 14;
// A 1,000-piece box is never narrower than this (the row scrolls instead) nor wider than that.
const SHELF_MIN_UNIT = 84;
const SHELF_MAX_UNIT = 164;
// The row is as tall as its biggest box stands when its lid is 5:4; a squarer lid is shrunk to fit.
const ROW_HEIGHT_PER_WIDTH = 0.8;

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A shelf row's sizes as CSS, for its inline style: `--unit` is the width of a 1,000-piece box,
 * the boxes sharing the row's width (its container's 100cqw) between the smallest and largest box,
 * and `--row-h` the row's height. The row's `gap` comes from here too, the same one `--unit` leaves
 * room for. In CSS so the server render is already right. Pure.
 */
export function shelfRowVars(scales: readonly number[]): React.CSSProperties {
  const sum = round(scales.reduce((a, b) => a + b, 0)) || 1;
  const gaps = Math.max(0, scales.length - 1) * SHELF_GAP;
  const maxScale = Math.max(1, ...scales);
  return {
    gap: SHELF_GAP,
    "--unit": `clamp(${SHELF_MIN_UNIT}px, calc((100cqw - ${gaps}px) / ${sum}), ${SHELF_MAX_UNIT}px)`,
    "--row-h": `calc(var(--unit) * ${round(maxScale * ROW_HEIGHT_PER_WIDTH)})`,
  } as React.CSSProperties;
}
