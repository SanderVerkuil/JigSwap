"use client";

import { cn } from "@/lib/utils";

// Minimal sparkbar chart from the design language: thin rounded bars whose
// opacity scales with their value, with muted labels underneath. Pure divs —
// no chart library needed for a single series.
export function Sparkbars({
  data,
  labels,
  color = "var(--jigsaw-primary)",
  height = 120,
  className,
}: {
  data: number[];
  labels?: string[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const max = Math.max(...data, 1);
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((value, i) => (
          <div
            key={i}
            title={String(value)}
            className="flex-1 rounded-[3px]"
            style={{
              height: Math.max(6, (value / max) * height),
              background: color,
              opacity: 0.45 + 0.55 * (value / max),
            }}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-2 flex gap-1.5">
          {labels.map((label, i) => (
            <span
              key={`${label}-${i}`}
              className="text-muted-foreground flex-1 text-center text-[10px] whitespace-nowrap"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Short localized month label ("Jan") from a "YYYY-MM" bucket key, parsed as
 * UTC so the label matches the server-side grouping in every timezone. */
export function monthLabel(bucket: string): string {
  const [year, month] = bucket.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString(undefined, {
    month: "short",
  });
}
