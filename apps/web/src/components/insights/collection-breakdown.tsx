"use client";

import { SectionHead } from "@/components/dashboard-home/section-head";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { FolderOpen } from "lucide-react";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { useFormatter, useTranslations } from "use-intl";

interface DistributionEntry {
  label: string;
  value: number;
}

export interface CollectionBreakdownData {
  byPieceCount: DistributionEntry[];
  byBrand: DistributionEntry[];
  byDifficulty: DistributionEntry[];
  byCondition: DistributionEntry[];
}

// The query's sentinel buckets: UNKNOWN_BUCKET (no value) and OTHER_BUCKET (brands beyond the top
// six) in packages/domain/src/insights/collection-breakdown.ts. The web doesn't depend on the domain
// package, so the two strings are mirrored here. They are translated, never shown.
export const UNKNOWN_BUCKET = "__unknown";
export const OTHER_BUCKET = "__other";

// A bucket's display label: the sentinels translated, anything else (a piece-count range, a brand,
// or an older backend's English "Unknown") as is.
export function bucketLabel(
  label: string,
  names: { unknown: string; other: string },
): string {
  if (label === UNKNOWN_BUCKET) return names.unknown;
  if (label === OTHER_BUCKET) return names.other;
  return label;
}

// A piece-count bucket's display label: the numbers in the member's own format ("1.000–1.999" in
// Dutch, "1,000–1,999" in English). Only for this chart: a brand may well be called "2000".
export function pieceCountLabel(
  label: string,
  names: { unknown: string; other: string },
  formatNumber: (value: number) => string,
): string {
  const range = /^(\d+)-(\d+)$/.exec(label);
  if (range) {
    return `${formatNumber(Number(range[1]))}–${formatNumber(Number(range[2]))}`;
  }
  const open = /^(< )?(\d+)(\+)?$/.exec(label);
  if (open) {
    return `${open[1] ?? ""}${formatNumber(Number(open[2]))}${open[3] ?? ""}`;
  }
  return bucketLabel(label, names);
}

// The brand bars in the query's order (top brands by count, then Other) without the copies that
// have no brand: those are counted apart for a note under the chart, so they never rank as a brand.
export function brandSeries(data: DistributionEntry[]): {
  bars: DistributionEntry[];
  withoutBrand: number;
} {
  return {
    bars: data.filter((e) => e.value > 0 && e.label !== UNKNOWN_BUCKET),
    withoutBrand: data.find((e) => e.label === UNKNOWN_BUCKET)?.value ?? 0,
  };
}

// Difficulty is ordered, so its colours are one violet ramp: in light mode from light (easy) to dark
// (expert), in dark mode from near the page (easy) to bright (expert), plus a grey for a difficulty
// the puzzle doesn't have. The colour belongs to the difficulty, never to its rank, so it stays put
// as counts change. Checked as an ordinal ramp against the page background (light #fdfdff, dark
// #1d1c34): one hue, lightness monotone with steps of at least 0.06 OKLCH L, the faintest step at
// least 2:1. Colour is never the only cue: the legend names every difficulty.
const DIFFICULTY_LEVELS = ["easy", "medium", "hard", "expert"] as const;
type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

const DIFFICULTY_SWATCH: Record<DifficultyLevel | "unknown", string> = {
  easy: "bg-[#a3a9f6] dark:bg-[#4c4a95]",
  medium: "bg-[#7e80ee] dark:bg-[#6b67d2]",
  hard: "bg-[#5e56de] dark:bg-[#8e8fef]",
  expert: "bg-[#4338ae] dark:bg-[#babdfe]",
  unknown: "bg-[#a4a4ac] dark:bg-[#686774]",
};

const isDifficultyLevel = (label: string): label is DifficultyLevel =>
  (DIFFICULTY_LEVELS as readonly string[]).includes(label);

function hasValues(entries: DistributionEntry[]): boolean {
  return entries.some((e) => e.value > 0);
}

// Height of one bar's row: a bar of at most BAR_SIZE plus the gap to the next one.
const BAR_SIZE = 28;
const BAR_ROW_HEIGHT = 40;

// Labelled horizontal bars with their values drawn, shared by Piece count and Top brands. The chart
// grows with its rows, so one or two get thin bars instead of bars stretched to a fixed height, and
// any number of labels stay legible at any width. It reads without hovering, so the bars don't
// animate: Recharts hides the labels while an animation runs, and any re-render with new rows would
// replay it. The drawing is aria-hidden and off the Tab order (accessibilityLayer would make the SVG
// an unnamed keyboard stop); screen readers get the same numbers from the table, in a figure named
// after the chart.
function BreakdownBars({
  title,
  rows,
  color,
}: {
  title: string;
  rows: DistributionEntry[];
  color: string;
}) {
  const t = useTranslations("insights.breakdown");
  const format = useFormatter();
  const config = {
    value: { label: t("count"), color },
  } satisfies ChartConfig;

  return (
    <figure aria-label={title}>
      <div aria-hidden="true">
        <ChartContainer
          config={config}
          className="w-full"
          style={{ height: rows.length * BAR_ROW_HEIGHT }}
        >
          <BarChart
            accessibilityLayer={false}
            data={rows}
            layout="vertical"
            margin={{ left: 8, right: 32 }}
          >
            <YAxis
              dataKey="label"
              type="category"
              tickLine={false}
              axisLine={false}
              width={96}
              tickMargin={4}
            />
            {/* The longest bar fills the row. With the default domain a maximum of 1 drew a
                quarter of it, on a scale from 0 to 4. */}
            <XAxis
              type="number"
              hide
              allowDecimals={false}
              domain={[0, "dataMax"]}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              radius={4}
              maxBarSize={BAR_SIZE}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="right"
                className="fill-foreground text-xs"
                formatter={(value) =>
                  typeof value === "number" ? format.number(value) : value
                }
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
      <table aria-label={title} className="sr-only">
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col">{t("count")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, value }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{format.number(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// Piece-count ranges in the query's order, low to high, then the copies without a count.
function PieceCountChart({ data }: { data: DistributionEntry[] }) {
  const t = useTranslations("insights.breakdown");
  const format = useFormatter();
  const names = { unknown: t("unknown"), other: t("other") };
  return (
    <BreakdownBars
      title={t("pieceCount")}
      color="var(--chart-1)"
      rows={data.map((e) => ({
        ...e,
        label: pieceCountLabel(e.label, names, (value) => format.number(value)),
      }))}
    />
  );
}

// Top brands in the query's order: the six biggest brands, then Other. Copies without a brand are
// not a brand; a note under the bars counts them.
function BrandChart({ data }: { data: DistributionEntry[] }) {
  const t = useTranslations("insights.breakdown");
  const names = { unknown: t("unknown"), other: t("other") };
  const { bars, withoutBrand } = brandSeries(data);

  return (
    <div className="space-y-2">
      {bars.length > 0 && (
        <BreakdownBars
          title={t("brands")}
          color="var(--chart-2)"
          rows={bars.map((e) => ({
            ...e,
            label: bucketLabel(e.label, names),
          }))}
        />
      )}
      {withoutBrand > 0 && (
        <p className="text-muted-foreground text-xs">
          {t("withoutBrand", { count: withoutBrand })}
        </p>
      )}
    </div>
  );
}

interface DifficultySlice {
  // The difficulty level, or "unknown" for UNKNOWN_BUCKET and any other label; picks the colour.
  key: DifficultyLevel | "unknown";
  label: string;
  value: number;
}

// The known difficulties from easy to expert, whatever their counts, then the copies without one
// (UNKNOWN_BUCKET, translated); a label the client doesn't know (an older backend's English
// "Unknown") is shown as is.
function difficultySlices(
  data: DistributionEntry[],
  difficultyLabel: (level: DifficultyLevel | "unknown") => string,
): DifficultySlice[] {
  const known = DIFFICULTY_LEVELS.flatMap((level) => {
    const value = data.find((d) => d.label === level)?.value ?? 0;
    return value > 0
      ? [{ key: level, label: difficultyLabel(level), value }]
      : [];
  });
  const rest = data
    .filter((d) => d.value > 0 && !isDifficultyLevel(d.label))
    .map((d) => ({
      key: "unknown" as const,
      label: d.label === UNKNOWN_BUCKET ? difficultyLabel("unknown") : d.label,
      value: d.value,
    }));
  return [...known, ...rest];
}

// "By difficulty" as a stacked bar over a legend list. The bar is drawn for sighted readers only;
// the legend names each difficulty in the app's language with its count and share, so nothing
// depends on hovering or on telling colours apart.
function DifficultyChart({ data }: { data: DistributionEntry[] }) {
  const t = useTranslations("insights.breakdown");
  const tDifficulty = useTranslations("puzzles.puzzles.difficulty");
  const format = useFormatter();
  const slices = difficultySlices(data, (level) => tDifficulty(level));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm">{t("difficultyTotal", { count: total })}</p>
      <div
        aria-hidden="true"
        data-difficulty-bar
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
      >
        {slices.map((slice) => (
          <div
            key={slice.label}
            data-difficulty={slice.key}
            className={cn("h-full min-w-1", DIFFICULTY_SWATCH[slice.key])}
            style={{ flex: `${slice.value} 1 0%` }}
          />
        ))}
      </div>
      <ul aria-label={t("difficulty")} className="space-y-2 text-sm">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                DIFFICULTY_SWATCH[slice.key],
              )}
            />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="font-medium tabular-nums">
              {format.number(slice.value)}
            </span>
            <span className="text-muted-foreground w-12 text-right tabular-nums">
              {format.number(slice.value / total, { style: "percent" })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Open (card-free) breakdown block: a muted sub-heading over a thin rule, the
// chart breathing directly on the page ground.
function BreakdownBlock({
  title,
  data,
  className,
  children,
}: {
  title: string;
  data: DistributionEntry[];
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("insights.breakdown");
  return (
    <div className={cn("min-w-0", className)}>
      <h3 className="text-muted-foreground mb-4 border-b pb-2 text-sm font-semibold">
        {title}
      </h3>
      {hasValues(data) ? (
        children
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      )}
    </div>
  );
}

export function CollectionBreakdown({
  data,
}: {
  data: CollectionBreakdownData;
}) {
  const t = useTranslations("insights.breakdown");
  return (
    <section>
      <SectionHead title={t("title")} icon={FolderOpen} />
      {/* Three columns next to an open sidebar leave a chart 209px at 1024 wide, most of it taken by
          the labels: the piece-count block takes the full width until 1280. */}
      <div className="grid gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <BreakdownBlock
          title={t("pieceCount")}
          data={data.byPieceCount}
          className="lg:col-span-2 xl:col-span-1"
        >
          <PieceCountChart data={data.byPieceCount} />
        </BreakdownBlock>
        <BreakdownBlock title={t("difficulty")} data={data.byDifficulty}>
          <DifficultyChart data={data.byDifficulty} />
        </BreakdownBlock>
        <BreakdownBlock title={t("brands")} data={data.byBrand}>
          <BrandChart data={data.byBrand} />
        </BreakdownBlock>
      </div>
    </section>
  );
}
