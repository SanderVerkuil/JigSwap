import type { useTranslations } from "use-intl";

// Shared by the member's own completion log and the profile completions list.

// Route target for a completion's server-resolved navigation link (ids are doc _ids).
export function hrefForLink(link: {
  kind: "myCopy" | "copy" | "definition";
  id: string;
}): string {
  if (link.kind === "myCopy") return `/my-puzzles/${link.id}`;
  if (link.kind === "copy") return `/copies/${link.id}`;
  return `/puzzles/${link.id}`;
}

// Day-aware solve-time label ("2h 5m", "3 days", "1d 2h 0m"), or "No time recorded".
export function formatSolveTime(
  t: ReturnType<typeof useTranslations<"solving.completions">>,
  minutes?: number,
): string {
  if (minutes === undefined) return t("noTime");
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
}
