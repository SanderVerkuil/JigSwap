"use client";

// The week-at-a-glance KPI header: four stat tiles (approved / rejected /
// flags cleared / avg. review time) fed by the admin moderation-stats read
// model. Tones map to semantic tokens only — no raw palette colors.

import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import {
  CircleCheck,
  CircleX,
  Clock,
  Flag,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "use-intl";
import { formatAvgReview } from "./severity";

function KpiTile({
  icon: Icon,
  value,
  label,
  suffix,
  chipClass,
}: {
  icon: LucideIcon;
  value: string | undefined;
  label: string;
  suffix: string;
  chipClass: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-4">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${chipClass}`}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        {value === undefined ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <div className="text-2xl leading-none font-bold">{value}</div>
        )}
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {label} <span className="opacity-70">· {suffix}</span>
        </div>
      </div>
    </div>
  );
}

export function KpiRow() {
  const t = useTranslations("admin.moderation.kpis");
  const stats = useQuery(gateway.admin.getModerationStats);
  const thisWeek = t("thisWeek");

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        icon={CircleCheck}
        value={stats && String(stats.approved)}
        label={t("approved")}
        suffix={thisWeek}
        chipClass="bg-jigsaw-success/15 text-jigsaw-success"
      />
      <KpiTile
        icon={CircleX}
        value={stats && String(stats.rejected)}
        label={t("rejected")}
        suffix={thisWeek}
        chipClass="bg-destructive/15 text-destructive"
      />
      <KpiTile
        icon={Flag}
        value={stats && String(stats.flagsCleared)}
        label={t("flagsCleared")}
        suffix={thisWeek}
        chipClass="bg-primary/15 text-primary"
      />
      <KpiTile
        icon={Clock}
        value={stats && formatAvgReview(stats.avgReviewMins)}
        label={t("avgReview")}
        suffix={thisWeek}
        chipClass="bg-muted text-muted-foreground"
      />
    </div>
  );
}
