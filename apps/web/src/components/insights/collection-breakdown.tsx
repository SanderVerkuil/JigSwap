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
import { useMemo } from "react";
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

function PieceCountChart({ data }: { data: DistributionEntry[] }) {
  const t = useTranslations("insights.breakdown");
  const config = {
    value: { label: t("count"), color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 8 }}>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={28}
          allowDecimals={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

function BrandChart({ data }: { data: DistributionEntry[] }) {
  const t = useTranslations("insights.breakdown");
  // Top 6 brands, longest bar first, so a long tail of one-offs doesn't crowd the chart.
  const top = useMemo(
    () => [...data].sort((a, b) => b.value - a.value).slice(0, 6),
    [data],
  );
  const config = {
    value: { label: t("count"), color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <BarChart data={top} layout="vertical" margin={{ left: 8, right: 24 }}>
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={96}
          tickMargin={4}
        />
        <XAxis type="number" hide allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4}>
          <LabelList
            dataKey="value"
            position="right"
            className="fill-foreground text-xs"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

interface DifficultySlice {
  // The difficulty level, or "unknown" for any other label; picks the colour.
  key: DifficultyLevel | "unknown";
  label: string;
  value: number;
}

// The known difficulties from easy to expert, whatever their counts, then anything else under its
// own label (an older backend sends the English word for copies without a difficulty).
function difficultySlices(
  data: DistributionEntry[],
  difficultyLabel: (level: DifficultyLevel) => string,
): DifficultySlice[] {
  const known = DIFFICULTY_LEVELS.flatMap((level) => {
    const value = data.find((d) => d.label === level)?.value ?? 0;
    return value > 0
      ? [{ key: level, label: difficultyLabel(level), value }]
      : [];
  });
  const rest = data
    .filter((d) => d.value > 0 && !isDifficultyLevel(d.label))
    .map((d) => ({ key: "unknown" as const, label: d.label, value: d.value }));
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
  children,
}: {
  title: string;
  data: DistributionEntry[];
  children: React.ReactNode;
}) {
  const t = useTranslations("insights.breakdown");
  return (
    <div className="min-w-0">
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
      <div className="grid gap-8 lg:grid-cols-3">
        <BreakdownBlock title={t("pieceCount")} data={data.byPieceCount}>
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
