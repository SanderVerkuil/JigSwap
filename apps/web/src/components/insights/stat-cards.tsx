"use client";

import { StatRow } from "@/components/library/stat-row";
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

// Card-free personal stats: a big divided headline row for the four numbers
// that matter most, with the remaining figures as a quieter second row.
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
    <div className="flex flex-col gap-8">
      <StatRow
        stats={[
          {
            label: t("completions"),
            value: String(stats.completionsCount),
          },
          {
            label: t("solveTime"),
            value: formatTime(stats.totalSolveMinutes),
          },
          {
            label: t("puzzlesOwned"),
            value: String(stats.puzzlesOwned),
          },
          {
            label: t("exchangesCompleted"),
            value: String(stats.exchangesCompleted),
          },
        ]}
      />
      <StatRow
        size="md"
        stats={[
          {
            label: t("collections"),
            value: String(stats.collectionsCount),
          },
          {
            label: t("distinctDefinitions"),
            value: String(stats.distinctDefinitions),
          },
          {
            label: t("goals"),
            value: String(stats.goalsAchieved),
            sub: t("goalsValue", {
              achieved: stats.goalsAchieved,
              active: stats.goalsActive,
            }),
          },
          {
            label: t("ratingGiven"),
            value: formatRating(stats.averageRatingGiven),
          },
          {
            label: t("ratingReceived"),
            value: formatRating(stats.averageRatingReceived),
          },
        ]}
      />
    </div>
  );
}
