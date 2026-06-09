"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

interface StatusCount {
  status: string;
  count: number;
}

export interface TradeActivityData {
  total: number;
  byStatus: StatusCount[];
  byMonth: { month: string; count: number }[];
}

export function TradeActivityChart({ data }: { data: TradeActivityData }) {
  const t = useTranslations("insights.trades");

  // The domain returns the full status set (zeros included); translate each status label and keep
  // the server-defined order. Tooltip reads the localized label via `nameKey`.
  const chartData = useMemo(
    () =>
      data.byStatus.map((s) => ({
        status: s.status,
        label: t(`status.${s.status}` as never),
        count: s.count,
      })),
    [data.byStatus, t],
  );

  const config = {
    count: { label: t("count"), color: "var(--chart-3)" },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.total > 0 ? (
          <ChartContainer config={config} className="h-[240px] w-full">
            <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} />
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
              <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
