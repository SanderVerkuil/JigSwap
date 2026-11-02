import { cn } from "@/lib/utils";

// The row of Dutch gables that signs the app and the public footer, standing shoulder to shoulder as
// a real street does. One flat colour from `currentColor`; only some windows are drawn, in
// --skyline-window, so a caller can leave them invisible by day and light them at night. Decorative,
// so it is hidden from assistive technology. Drawn at 1:1 for a 480x120 box; callers size and crop it.
const FACADES = [
  // Stepped gable
  "M0 120V62h6v-8h6v-8h5v-8h10v8h5v8h6v8h6v58z",
  // Bell gable
  "M44 120V62c0-6 6-6 8-12 2-6 0-10 4-14 2-2 4-3 5-6h6c1 3 3 4 5 6 4 4 2 8 4 14 2 6 8 6 8 12v58z",
  // Pitched house
  "M84 120V70l19-26 19 26v50z",
  // Church tower and spire
  "M122 120V58h8V40l6-6 5-30 5 30 6 6v18h8v62z",
  // Neck gable
  "M160 120V66h6v-6c6 0 8-4 8-10v-6h6V34h6v10h6v6c0 6 2 10 8 10v6h6v54z",
  // Tall stepped gable
  "M206 120V62h6v-8h6v-8h5v-8h6v8h5v8h6v8h6v58z",
  // Low pitched house
  "M246 120V78l19-22 19 22v42z",
  // Windmill tower
  "M284 120V96h14l4-22h12l4 22h12v24z",
  // Bell gable
  "M330 120V64c0-6 5-6 7-11 2-6 0-9 4-13 2-2 3-3 4-6h6c1 3 2 4 4 6 4 4 2 7 4 13 2 5 7 5 7 11h6v56z",
  // Stepped gable
  "M372 120V70h6v-8h6v-8h5v-8h6v8h5v8h6v8h8v50z",
  // Pitched house
  "M414 120V74l19-24 19 24v46z",
  // Neck gable, running off the edge
  "M452 120V78h4v-6c4 0 6-3 6-7v-5h6v-6h12v66z",
];

// [x, y] of the lit windows; each is 7 by 10.
const LIT_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [18, 72],
  [60, 56],
  [50, 76],
  [138, 72],
  [168, 80],
  [224, 54],
  [258, 88],
  [340, 76],
  [352, 56],
  [388, 62],
  [378, 86],
  [430, 76],
];

export function StreetSkyline({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 480 120"
      preserveAspectRatio="xMinYMax meet"
      className={cn("block", className)}
      fill="currentColor"
    >
      {FACADES.map((d) => (
        <path key={d} d={d} />
      ))}
      {/* The windmill's sails */}
      <path
        d="M308 72 284 48M308 72l24-24M308 72 284 96M308 72l24 24"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="square"
      />
      <g fill="var(--skyline-window, transparent)">
        {LIT_WINDOWS.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="7" height="10" />
        ))}
      </g>
    </svg>
  );
}
