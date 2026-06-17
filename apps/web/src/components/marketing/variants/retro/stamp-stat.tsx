import { cn } from "@/lib/utils";
import * as React from "react";

// A single rubber-stamp stat: cream ink-stamp on the teal band, big slab
// numeral + one-word caption. Accessible loading: a pulsing placeholder, the
// caption visible, and NO fabricated zero announced.
export function StampStat({
  value,
  caption,
  rotate,
}: {
  value: number | undefined;
  caption: string;
  rotate: string;
}) {
  const loading = value === undefined;

  return (
    <div
      className="v-stamp flex aspect-square w-[clamp(150px,22vw,196px)] flex-col items-center justify-center rounded-full p-4 text-center max-[860px]:[transform:rotate(var(--v-stamp-rot-sm))]"
      style={
        {
          color: "#fbf3df",
          transform: `rotate(${rotate})`,
          ["--v-stamp-rot-sm" as string]: rotate.startsWith("-")
            ? "-1deg"
            : "1deg",
        } as React.CSSProperties
      }
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-9 w-20 animate-pulse rounded-[4px] bg-[#fbf3df]/40"
        />
      ) : (
        <span className="font-mk-heading text-[clamp(34px,5vw,52px)] leading-none font-extrabold tabular-nums">
          {value.toLocaleString()}
        </span>
      )}
      <span
        className={cn(
          "mt-2 max-w-[12ch] font-mono text-[11px] font-bold tracking-[0.12em] uppercase",
        )}
      >
        {caption}
      </span>
    </div>
  );
}
