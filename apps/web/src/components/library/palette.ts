// Brand palette rotation for gradient cover chips. Items that carry their own
// color (collections) use it; everything else (completions, fallbacks) rotates
// through the brand hues so covers are never an empty gray box.
const CHIP_PALETTE = [
  "#6048e8", // jig violet
  "#19c316", // swap green
  "#ec4899", // piece pink
  "#f59e0b", // amber
  "#494e92", // deep indigo
  "#0ea5e9", // sky
];

export function chipColor(index: number): string {
  return CHIP_PALETTE[index % CHIP_PALETTE.length];
}

/** The signature gradient wash: the hue falling toward its darker self. */
export function chipGradient(color: string): string {
  return `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color}, black 28%))`;
}
