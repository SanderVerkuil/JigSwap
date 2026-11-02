import type { useFormatter } from "use-intl";

// The one convention for date-only values (solve start/end dates, past-solve dates): a calendar
// date is stored as UTC midnight of that date (Date.UTC(y, m, d)).
//
// The server depends on it. Completion trends and swap activity bucket by UTC month, the year-only
// sentinel (yearSentinel) is a UTC instant, and stats compare against UTC year starts. Parsing at
// local midnight instead would move a solve on the 1st into the previous month for members east of
// UTC. So: pick "today" from the member's local calendar, store that date as UTC midnight, and
// read and format stored dates in UTC, so every member sees the date they picked.
//
// Keep `timeZone: "UTC"` (DATE_ONLY_TIME_ZONE) when formatting these values, also with use-intl.

export const DATE_ONLY_TIME_ZONE = "UTC";

const DAY_MS = 86_400_000;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

// The member's local calendar day as a `yyyy-mm-dd` date input value. Not toISOString(): that is
// the UTC day, which is yesterday just after local midnight east of UTC.
export function localTodayInput(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// A date input value (`yyyy-mm-dd`) -> epoch ms at UTC midnight of that date, or undefined when
// empty or not a real date (an empty end date keeps a solve in progress).
export function dateInputToMs(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0-99 to 1900+; set the full year explicitly so the round-trip check holds.
  at.setUTCFullYear(year);
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  ) {
    return undefined;
  }
  return at.getTime();
}

// A stored date (epoch ms) -> `yyyy-mm-dd` for a date input, read in UTC; empty for no date.
export function msToDateInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const at = new Date(ms);
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

// A stored date in the app locale (use-intl's formatter, UX-63), in UTC so it is the date the
// member picked.
export function formatDateOnly(
  format: ReturnType<typeof useFormatter>,
  ms: number,
): string {
  return format.dateTime(ms, {
    dateStyle: "medium",
    timeZone: DATE_ONLY_TIME_ZONE,
  });
}

// Today as a stored date (UTC midnight), on the runtime's own calendar. In the browser that is the
// member's. A server-rendered page must not read this during render: see hooks/use-member-today.
export function localTodayMs(now: Date = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

// Today as a stored date, on the calendar of a named time zone: the same on any runtime.
export function zonedTodayMs(now: Date, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

// Whole calendar days from a stored date to `today` (a stored date too): 0 for today, negative for a
// future date. A legacy instant counts by its UTC calendar day.
export function calendarDaysSince(ms: number, today: number): number {
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  return Math.round((today - day) / DAY_MS);
}
