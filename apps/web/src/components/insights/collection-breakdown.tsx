"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "use-intl";

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

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

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

function DifficultyChart({ data }: { data: DistributionEntry[] }) {
  const t = useTranslations("insights.breakdown");
  const config = useMemo(() => {
    const c: ChartConfig = { value: { label: t("count") } };
    data.forEach((d, i) => {
      c[d.label] = { label: d.label, color: PALETTE[i % PALETTE.length] };
    });
    return c;
  }, [data, t]);

  return (
    <ChartContainer
      config={config}
      className="mx-auto aspect-square max-h-[220px]"
    >
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={50}>
          {data.map((entry, i) => (
            <Cell key={entry.label} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

function BreakdownCard({
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasValues(data) ? (
          children
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function CollectionBreakdown({
  data,
}: {
  data: CollectionBreakdownData;
}) {
  const t = useTranslations("insights.breakdown");
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <BreakdownCard title={t("pieceCount")} data={data.byPieceCount}>
          <PieceCountChart data={data.byPieceCount} />
        </BreakdownCard>
        <BreakdownCard title={t("difficulty")} data={data.byDifficulty}>
          <DifficultyChart data={data.byDifficulty} />
        </BreakdownCard>
        <BreakdownCard title={t("brands")} data={data.byBrand}>
          <BrandChart data={data.byBrand} />
        </BreakdownCard>
      </div>
    </div>
  );
}
