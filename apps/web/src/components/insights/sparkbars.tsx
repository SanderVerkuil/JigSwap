"use client";

import { DATE_ONLY_TIME_ZONE } from "@/lib/date-input";
import { cn } from "@/lib/utils";
import { useId } from "react";
import { useFormatter, useTranslations } from "use-intl";

export interface SparkbarPoint {
  // "YYYY-MM" month bucket (UTC), as the insights queries return it.
  month: string;
  value: number;
}

// Room above a bar for its value label (text-xs, leading-none) and the gap under it.
const LABEL_SPACE = 20;

// First instant of a "YYYY-MM" bucket. The server groups by UTC month, so the bucket is formatted
// in UTC (DATE_ONLY_TIME_ZONE): read in local time it is still the previous month west of UTC.
const monthStart = (month: string): Date => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1));
};

// Monthly sparkbar chart from the design language: thin rounded bars whose opacity scales with
// their value, with short month names underneath. Pure divs, no chart library.
//
// It reads without hovering: the figure is named by its visible caption, every month with a value
// carries that value above its bar, and an empty month is a 1px baseline rather than a short bar,
// so a gap looks like a gap. The drawing is aria-hidden; screen readers get a table of month and
// value with the same numbers.
export function Sparkbars({
  points,
  caption,
  valueLabel,
  color = "var(--jigsaw-primary)",
  height = 120,
  className,
}: {
  points: SparkbarPoint[];
  // Visible caption under the section head; also the figure's and the table's accessible name.
  caption: string;
  // Header of the value column in the screen-reader table, e.g. "Completions".
  valueLabel: string;
  color?: string;
  height?: number;
  className?: string;
}) {
  const t = useTranslations("insights.charts");
  const format = useFormatter();
  const captionId = useId();
  const max = Math.max(...points.map((p) => p.value), 1);
  const barSpace = height - LABEL_SPACE;

  return (
    <figure aria-labelledby={captionId} className={cn("w-full", className)}>
      <figcaption id={captionId} className="text-muted-foreground mb-4 text-sm">
        {caption}
      </figcaption>
      <div aria-hidden="true">
        <div className="flex items-end gap-1.5" style={{ height }}>
          {points.map(({ month, value }) => (
            <div
              key={month}
              data-month={month}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              {value > 0 ? (
                <>
                  <span
                    data-value
                    className="text-xs leading-none font-medium whitespace-nowrap tabular-nums"
                  >
                    {format.number(value, {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    })}
                  </span>
                  <div
                    data-bar
                    className="w-full rounded-[3px]"
                    style={{
                      height: Math.max(4, (value / max) * barSpace),
                      background: color,
                      opacity: 0.45 + 0.55 * (value / max),
                    }}
                  />
                </>
              ) : (
                <div data-baseline className="bg-border h-px w-full" />
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          {points.map(({ month }) => (
            <span
              key={month}
              data-month-label
              className="text-muted-foreground min-w-0 flex-1 text-center text-xs whitespace-nowrap"
            >
              {monthLabel(format, month)}
            </span>
          ))}
        </div>
      </div>
      <table aria-labelledby={captionId} className="sr-only">
        <thead>
          <tr>
            <th scope="col">{t("month")}</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map(({ month, value }) => (
            <tr key={month}>
              <th scope="row">
                {format.dateTime(monthStart(month), {
                  month: "long",
                  year: "numeric",
                  timeZone: DATE_ONLY_TIME_ZONE,
                })}
              </th>
              <td>{format.number(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// Short month label in the app locale ("Jan", "mrt") from a "YYYY-MM" bucket, read in UTC.
export function monthLabel(
  format: ReturnType<typeof useFormatter>,
  bucket: string,
): string {
  return format.dateTime(monthStart(bucket), {
    month: "short",
    timeZone: DATE_ONLY_TIME_ZONE,
  });
}
