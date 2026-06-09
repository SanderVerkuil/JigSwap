"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeftRight,
  CircleCheck,
  Clock,
  FolderOpen,
  Package,
  Star,
  Target,
} from "lucide-react";
import { useTranslations } from "use-intl";

export interface PersonalStats {
  completionsCount: number;
  totalSolveMinutes: number;
  averageSolveMinutes: number;
  puzzlesOwned: number;
  distinctDefinitions: number;
  collectionsCount: number;
  exchangesCompleted: number;
  averageRatingGiven: number;
  averageRatingReceived: number;
  goalsActive: number;
  goalsAchieved: number;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold leading-tight">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCards({ stats }: { stats: PersonalStats }) {
  const t = useTranslations("insights.stats");

  const formatTime = (minutes: number): string => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0
      ? t("time", { hours: h, minutes: m })
      : t("timeMinutes", { minutes: m });
  };

  // A 0 rating means "no ratings yet" in the read model (mean of empty set), so show a dash
  // rather than a misleading 0.0.
  const formatRating = (rating: number): string =>
    rating > 0 ? rating.toFixed(1) : t("ratingNone");

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      <StatCard
        icon={CircleCheck}
        label={t("completions")}
        value={String(stats.completionsCount)}
      />
      <StatCard
        icon={Clock}
        label={t("solveTime")}
        value={formatTime(stats.totalSolveMinutes)}
      />
      <StatCard
        icon={Package}
        label={t("puzzlesOwned")}
        value={String(stats.puzzlesOwned)}
        hint={t("distinctDefinitions") + ": " + stats.distinctDefinitions}
      />
      <StatCard
        icon={FolderOpen}
        label={t("collections")}
        value={String(stats.collectionsCount)}
      />
      <StatCard
        icon={ArrowLeftRight}
        label={t("exchangesCompleted")}
        value={String(stats.exchangesCompleted)}
      />
      <StatCard
        icon={Target}
        label={t("goals")}
        value={String(stats.goalsAchieved)}
        hint={t("goalsValue", {
          achieved: stats.goalsAchieved,
          active: stats.goalsActive,
        })}
      />
      <StatCard
        icon={Star}
        label={t("ratingGiven")}
        value={formatRating(stats.averageRatingGiven)}
      />
      <StatCard
        icon={Star}
        label={t("ratingReceived")}
        value={formatRating(stats.averageRatingReceived)}
      />
    </div>
  );
}
