"use client";

import { SectionHead } from "@/components/dashboard-home/section-head";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { monthLabel, Sparkbars } from "./sparkbars";

export interface CompletionTrendPoint {
  month: string;
  count: number;
  totalMinutes: number;
}

type Metric = "count" | "minutes";

// "Completions / month" as a minimal sparkbar chart (design language), with the
// existing count/minutes metric toggle kept as small pills in the section head.
export function CompletionTrendsChart({
  data,
}: {
  data: CompletionTrendPoint[];
}) {
  const t = useTranslations("insights");
  const [metric, setMetric] = useState<Metric>("count");

  const hasData = data.some((d) => d.count > 0);
  const values = data.map((d) =>
    metric === "count" ? d.count : d.totalMinutes,
  );
  const labels = data.map((d) => monthLabel(d.month));

  return (
    <section className="min-w-0">
      <SectionHead
        title={t("charts.completionsPerMonth")}
        icon={BarChart3}
        action={
          <div className="flex gap-1.5">
            {(["count", "minutes"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={metric === option}
                onClick={() => setMetric(option)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                  metric === option
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent text-foreground",
                )}
              >
                {t(`trends.${option}`)}
              </button>
            ))}
          </div>
        }
      />
      {hasData ? (
        <Sparkbars
          data={values}
          labels={labels}
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
