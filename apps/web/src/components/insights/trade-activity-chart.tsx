"use client";

import { SectionHead } from "@/components/dashboard-home/section-head";
import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { Sparkbars } from "./sparkbars";

interface StatusCount {
  status: string;
  count: number;
}

export interface TradeActivityData {
  total: number;
  byStatus: StatusCount[];
  byMonth: { month: string; count: number }[];
}

// "Swaps / month" as a minimal sparkbar chart, with the per-status counts the
// old bar chart carried kept as a muted summary line underneath.
export function TradeActivityChart({ data }: { data: TradeActivityData }) {
  const t = useTranslations("insights");

  const points = data.byMonth.map((m) => ({ month: m.month, value: m.count }));

  // Localized "2 Completed · 1 Proposed" summary of the non-empty statuses,
  // preserving the server-defined order.
  const statusSummary = data.byStatus
    .filter((s) => s.count > 0)
    .map((s) => `${s.count} ${t(`trades.status.${s.status}` as never)}`)
    .join(" · ");

  return (
    <section className="min-w-0">
      <SectionHead title={t("charts.swapsPerMonth")} icon={ArrowLeftRight} />
      {data.total > 0 ? (
        <>
          <Sparkbars
            points={points}
            caption={t("trades.caption")}
            valueLabel={t("trades.count")}
            color="var(--jigsaw-secondary)"
          />
          {statusSummary && (
            <p className="text-muted-foreground mt-3 text-xs">
              {statusSummary}
            </p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t("trades.empty")}
        </p>
      )}
    </section>
  );
}
