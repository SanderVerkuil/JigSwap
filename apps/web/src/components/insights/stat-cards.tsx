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
  averageRatingGiven: number | null;
  averageRatingReceived: number;
  goalsAchieved: number;
  // Every goal, archived ones included. Optional: a backend without it shows no goals sub-line.
  goalsTotal?: number;
}

// Card-free personal stats: a big divided headline row for the four numbers
// that matter most, with the remaining figures as a quieter second row (three
// to a row on phones, so the first screen isn't only stats).
export function StatCards({ stats }: { stats: PersonalStats }) {
  const t = useTranslations("insights.stats");

  const formatTime = (minutes: number): string => {
    const days = Math.floor(minutes / 1440);
    const rest = minutes % 1440;
    const h = Math.floor(rest / 60);
    const m = rest % 60;
    if (days > 0) {
      return h === 0 && m === 0
        ? t("timeDays", { days })
        : t("timeDaysHours", { days, hours: h, minutes: m });
    }
    return h > 0
      ? t("time", { hours: h, minutes: m })
      : t("timeMinutes", { minutes: m });
  };

  // Null means "no ratings yet"; a 0 rating means the same in the legacy read model (mean of an
  // empty set), so both show the placeholder rather than a misleading 0.0.
  const formatRating = (rating: number | null): string =>
    rating != null && rating > 0 ? rating.toFixed(1) : t("ratingNone");

  // Before the first finished solve the solve figures are only zeros, and the page shows an
  // empty state that says how to start (InsightsEmptyState), so the headline keeps what the
  // member already has.
  const hasSolves = stats.completionsCount > 0;

  return (
    <div className="flex flex-col gap-8" data-tour="insights-stats">
      <StatRow
        stats={[
          ...(hasSolves
            ? [
                {
                  label: t("completions"),
                  value: String(stats.completionsCount),
                },
                {
                  label: t("solveTime"),
                  value: formatTime(stats.totalSolveMinutes),
                },
              ]
            : []),
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
        mobileCols={3}
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
            sub: stats.goalsTotal
              ? t("goalsOfTotal", {
                  achieved: stats.goalsAchieved,
                  total: stats.goalsTotal,
                })
              : undefined,
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
