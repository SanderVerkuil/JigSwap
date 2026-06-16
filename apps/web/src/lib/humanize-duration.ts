// Pick the largest sensible time unit for a duration given in minutes, plus the rounded count in
// that unit. Pair the result with Intl unit formatting (e.g. useFormatter().number(value, { style:
// "unit", unit, unitDisplay: "long" })) so plurals + locale come for free — "2 hours", "1 day",
// "4 days", "1 week", "1 month". Replaces the old "round to whole days" that collapsed a 1-hour
// solve to "0 days".

export type DurationUnit = "minute" | "hour" | "day" | "week" | "month";

export interface DurationParts {
  value: number;
  unit: DurationUnit;
}

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = MIN_PER_HOUR * 24;
const MIN_PER_WEEK = MIN_PER_DAY * 7;
// ~1 month. Approximate on purpose — this is a humanized label, not an accounting figure.
const MIN_PER_MONTH = MIN_PER_DAY * 30;

/**
 * Convert a duration in minutes to a {value, unit} pair using the largest unit that keeps the
 * number small and readable. Sub-hour durations stay in minutes (min 1); months are the ceiling.
 */
export function durationParts(totalMinutes: number): DurationParts {
  const m = Math.max(0, totalMinutes);
  if (m < MIN_PER_HOUR)
    return { value: Math.max(1, Math.round(m)), unit: "minute" };
  if (m < MIN_PER_DAY)
    return { value: Math.round(m / MIN_PER_HOUR), unit: "hour" };
  if (m < MIN_PER_WEEK)
    return { value: Math.round(m / MIN_PER_DAY), unit: "day" };
  if (m < MIN_PER_MONTH)
    return { value: Math.round(m / MIN_PER_WEEK), unit: "week" };
  return { value: Math.round(m / MIN_PER_MONTH), unit: "month" };
}
