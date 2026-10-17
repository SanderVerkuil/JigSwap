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

// The pieces of a completion its date label and "this year" need. `datePrecision` absent = "day".
type DatedCompletion = {
  startDate: number;
  endDate?: number;
  datePrecision?: "day" | "year" | "unknown";
};

// A finished solve's date: the date itself, "In 2023" for a year-only solve, or "Date unknown".
// Year-only and undated solves hold sentinel dates, so those are never shown as dates.
export function formatCompletionDate(
  t: ReturnType<typeof useTranslations<"solving.completions">>,
  completion: DatedCompletion,
): string {
  const at = completion.endDate ?? completion.startDate;
  if (completion.datePrecision === "unknown") return t("dateUnknown");
  // The year sentinel is mid-year at UTC noon, so its UTC year is the year the member chose.
  if (completion.datePrecision === "year") {
    return t("inYear", { year: String(new Date(at).getUTCFullYear()) });
  }
  return new Date(at).toLocaleDateString();
}

// Whether a finished solve counts toward the "This year" stat: dated and year-only solves in the
// year count; undated ones never do (their sentinel is the day they were logged).
export function countsTowardThisYear(
  completion: DatedCompletion,
  yearStart: number,
): boolean {
  if (completion.datePrecision === "unknown") return false;
  return (completion.endDate ?? completion.startDate) >= yearStart;
}
