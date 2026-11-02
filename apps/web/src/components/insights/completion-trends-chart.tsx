"use client";

import { SectionHead } from "@/components/dashboard-home/section-head";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Sparkbars } from "./sparkbars";

export interface CompletionTrendPoint {
  month: string;
  count: number;
  totalMinutes: number;
}

type Metric = "count" | "hours";

// Minutes as the hours a bar's label shows: one decimal under 10, whole from there, so twelve labels
// side by side fit a phone.
const solveHours = (minutes: number): number =>
  minutes < 600 ? Math.round(minutes / 6) / 10 : Math.round(minutes / 60);

// "Completions / month" as a minimal sparkbar chart (design language), with the count/hours metric
// toggle kept as small pills in the section head. The title, caption and table follow the metric
// that is showing. The pills only show when there is something to switch to: hours count only the
// times members typed, and year-only or undated solves have no month at all, so a member can have
// solves and still nothing dated here (the empty line says that).
export function CompletionTrendsChart({
  data,
}: {
  data: CompletionTrendPoint[];
}) {
  const t = useTranslations("insights");
  const [picked, setPicked] = useState<Metric>("count");

  const hasData = data.some((d) => d.count > 0);
  const hasHours = data.some((d) => d.totalMinutes > 0);
  const metric = hasHours ? picked : "count";
  const points = data.map((d) => ({
    month: d.month,
    value: metric === "count" ? d.count : solveHours(d.totalMinutes),
  }));

  return (
    <section className="min-w-0">
      <SectionHead
        title={t(
          metric === "count"
            ? "charts.completionsPerMonth"
            : "charts.hoursPerMonth",
        )}
        icon={BarChart3}
        action={
          hasHours ? (
            <div className="flex gap-1.5">
              {(["count", "hours"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={metric === option}
                  onClick={() => setPicked(option)}
                  className={cn(
                    "pointer-coarse:min-h-9 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    metric === option
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "bg-card hover:bg-accent text-foreground",
                  )}
                >
                  {t(`trends.${option}`)}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      {hasData ? (
        <Sparkbars
          points={points}
          caption={t(
            metric === "count"
              ? "trends.description"
              : "trends.hoursDescription",
          )}
          valueLabel={t(`trends.${metric}`)}
          color="var(--jigsaw-primary)"
        />
      ) : (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t("trends.empty")}
        </p>
      )}
    </section>
  );
}
