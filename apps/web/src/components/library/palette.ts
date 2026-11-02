// World palette rotation for cover chips. Items that carry their own color
// (collections) use it; everything else (completions, fallbacks) rotates through
// these so covers are never an empty gray box. Fixed paints rather than theme
// tokens: every one holds a white glyph at 4.5:1 in both themes, and they are
// only ever rendered, never stored.
const CHIP_PALETTE = [
  "#146350", // canal
  "#a86400", // ochre
  "#2b7bb9", // roof blue
  "#d6246e", // tulip
  "#1e7b34", // leaf
  "#8a6a3b", // plank
];

export function chipColor(index: number): string {
  return CHIP_PALETTE[index % CHIP_PALETTE.length];
}

/** The chip's fill. Flat now; the name stays for library/cover-chip.tsx, which calls it. */
export function chipGradient(color: string): string {
  return color;
}
