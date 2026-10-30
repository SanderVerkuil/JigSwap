"use client";

// The week-at-a-glance KPI header: four stat tiles (approved / rejected /
// flags cleared / avg. review time) fed by the admin moderation-stats read
// model, which counts the last 7 days. One caption above the grid names that
// period for all four, so each label has room to wrap to two lines (with the
// full label as a title) instead of being truncated on phones. Tones map to
// semantic tokens only — no raw palette colors.
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleX,
  Clock,
  Flag,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import { useTranslations } from "use-intl";
import { formatAvgReview } from "./severity";

function KpiTile({
  icon: Icon,
  value,
  label,
  chipClass,
}: {
  icon: LucideIcon;
  value: string | undefined;
  label: string;
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
        <div
          className="mt-1 line-clamp-2 text-xs text-muted-foreground"
          title={label}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

export function KpiRow() {
  const t = useTranslations("admin.moderation.kpis");
  const captionId = useId();
  const { data: stats } = useQuery(
    convexQuery(gateway.admin.getModerationStats, {}),
  );

  return (
    <section aria-labelledby={captionId} className="space-y-2">
      <h2
        id={captionId}
        className="text-xs font-medium tracking-wider text-muted-foreground uppercase"
      >
        {t("period")}
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          icon={CircleCheck}
          value={stats && String(stats.approved)}
          label={t("approved")}
          chipClass="bg-jigsaw-success/15 text-jigsaw-success"
        />
        <KpiTile
          icon={CircleX}
          value={stats && String(stats.rejected)}
          label={t("rejected")}
          chipClass="bg-destructive/15 text-destructive"
        />
        <KpiTile
          icon={Flag}
          value={stats && String(stats.flagsCleared)}
          label={t("flagsCleared")}
          chipClass="bg-primary/15 text-primary-text"
        />
        <KpiTile
          icon={Clock}
          value={stats && formatAvgReview(stats.avgReviewMins)}
          label={t("avgReview")}
          chipClass="bg-muted text-muted-foreground"
        />
      </div>
    </section>
  );
}
