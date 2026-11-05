import { formatDateOnly } from "@/lib/date-input";
import type { useFormatter, useTranslations } from "use-intl";

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
// Year-only and undated solves hold sentinel dates, so those are never shown as dates. A dated
// solve is a calendar date stored as UTC midnight, so it is formatted in UTC (lib/date-input),
// through the app's formatter so it follows the app locale (UX-63).
export function formatCompletionDate(
  t: ReturnType<typeof useTranslations<"solving.completions">>,
  format: ReturnType<typeof useFormatter>,
  completion: DatedCompletion,
): string {
  const at = completion.endDate ?? completion.startDate;
  if (completion.datePrecision === "unknown") return t("dateUnknown");
  // The year sentinel is mid-year at UTC noon, so its UTC year is the year the member chose.
  if (completion.datePrecision === "year") {
    return t("inYear", { year: String(new Date(at).getUTCFullYear()) });
  }
  return formatDateOnly(format, at);
}

const MINUTES_PER_DAY = 1440;
const DAY_MS = 86_400_000;

// What a finished solve's duration can honestly say: a time the member typed, the number of
// calendar days it spanned, or that it was done in one day.
export type SolveDurationLabel =
  | { kind: "time"; minutes: number }
  | { kind: "days"; days: number }
  | { kind: "sameDay" };

// The duration to show for a finished dated solve, or null when there is none to show (in
// progress, year-only, undated).
//
// The domain always stores a duration: with no time typed it derives one from the span, or uses
// one day (1440 minutes) when start equals end. So a stored duration only counts as typed when it
// differs from that derived value. A typed time that happens to equal it (exactly 24h on one day)
// reads as the span, which is still true.
export function solveDuration(
  completion: DatedCompletion & { completionTimeMinutes?: number },
): SolveDurationLabel | null {
  const { startDate, endDate, completionTimeMinutes } = completion;
  if ((completion.datePrecision ?? "day") !== "day") return null;
  if (endDate === undefined) return null;
  const spanMinutes = Math.round((endDate - startDate) / 60_000);
  const derived = spanMinutes > 0 ? spanMinutes : MINUTES_PER_DAY;
  if (
    completionTimeMinutes !== undefined &&
    completionTimeMinutes !== derived
  ) {
    return { kind: "time", minutes: completionTimeMinutes };
  }
  // Calendar days the solve spans, both ends included (dates are UTC midnight, lib/date-input).
  const days =
    Math.floor(endDate / DAY_MS) - Math.floor(startDate / DAY_MS) + 1;
  return days >= 2 ? { kind: "days", days } : { kind: "sameDay" };
}

// The line under a solve in the completion log: "Started {date}" while in progress, otherwise
// the piece count (or "Completed") and the duration, e.g. "1,000 pieces · 3h 20m".
export function formatCompletionMeta(
  t: ReturnType<typeof useTranslations<"solving.completions">>,
  format: ReturnType<typeof useFormatter>,
  completion: DatedCompletion & {
    isCompleted: boolean;
    completionTimeMinutes?: number;
  },
  pieceCount?: number,
): string {
  if (!completion.isCompleted) {
    return t("started", {
      date: formatDateOnly(format, completion.startDate),
    });
  }
  const parts = [
    pieceCount ? t("pieces", { pieces: pieceCount }) : t("completed"),
  ];
  const duration = solveDurationText(t, completion);
  if (duration) parts.push(duration);
  return parts.join(" · ");
}

// solveDuration in words: "3h 20m", "over 3 days" or "in one day"; null when there is none to show.
export function solveDurationText(
  t: ReturnType<typeof useTranslations<"solving.completions">>,
  completion: DatedCompletion & { completionTimeMinutes?: number },
): string | null {
  const duration = solveDuration(completion);
  if (duration?.kind === "time") return formatSolveTime(t, duration.minutes);
  if (duration?.kind === "days") {
    return t("overDays", { days: duration.days });
  }
  return duration?.kind === "sameDay" ? t("sameDay") : null;
}

// Whether a finished solve counts toward the "This year" stat: dated and year-only solves in the
// year count; undated ones never do (their sentinel is the day they were logged). `yearStart` is
// 1 January of the member's year at UTC midnight, matching how solve dates are stored.
export function countsTowardThisYear(
  completion: DatedCompletion,
  yearStart: number,
): boolean {
  if (completion.datePrecision === "unknown") return false;
  return (completion.endDate ?? completion.startDate) >= yearStart;
}
