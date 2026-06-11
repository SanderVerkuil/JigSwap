"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useTranslations } from "use-intl";

export interface CompletionTrendPoint {
  month: string;
  count: number;
  totalMinutes: number;
}

type Metric = "count" | "minutes";

export function CompletionTrendsChart({
  data,
}: {
  data: CompletionTrendPoint[];
}) {
  const t = useTranslations("insights.trends");
  const [metric, setMetric] = useState<Metric>("count");

  const hasData = data.some((d) => d.count > 0);

  // Short month labels ("Jan") from the "YYYY-MM" key; parsed as UTC so the label matches the
  // server-side grouping regardless of the viewer's timezone.
  const chartData = useMemo(
    () =>
      data.map((d) => {
        const [year, month] = d.month.split("-").map(Number);
        const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString(
          undefined,
          { month: "short" },
        );
        return {
          ...d,
          label,
          value: metric === "count" ? d.count : d.totalMinutes,
        };
      }),
    [data, metric],
  );

  const config = {
    value: {
      label: metric === "count" ? t("count") : t("minutes"),
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <CardAction>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={metric === "count" ? "default" : "outline"}
              onClick={() => setMetric("count")}
            >
              {t("count")}
            </Button>
            <Button
              size="sm"
              variant={metric === "minutes" ? "default" : "outline"}
              onClick={() => setMetric("minutes")}
            >
              {t("minutes")}
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ChartContainer config={config} className="h-[240px] w-full">
            <AreaChart data={chartData} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={32}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="value"
                type="monotone"
                fill="var(--color-value)"
                fillOpacity={0.2}
                stroke="var(--color-value)"
                strokeWidth={2}
              />
            </AreaChart>
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
