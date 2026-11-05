// The calendar-month buckets the insights charts share. Months are UTC so grouping is
// timezone-stable and deterministic; the web formats the "YYYY-MM" keys in UTC to match.

// How far back the monthly insights charts look.
export const DEFAULT_WINDOW_MONTHS = 12;

// "YYYY-MM" (UTC) for an epoch-ms instant, so keys sort lexicographically by chronology.
export const monthKey = (epochMs: number): string => {
  const d = new Date(epochMs);
  const year = d.getUTCFullYear();
  const month = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
};

// The last `windowMonths` month keys ending at the month of `now` (inclusive), oldest first. A
// chart seeds every one of them to zero, so a quiet month still renders as a gap instead of
// disappearing.
export const lastMonthKeys = (now: number, windowMonths: number): string[] => {
  const nowDate = new Date(now);
  const year = nowDate.getUTCFullYear();
  const month = nowDate.getUTCMonth();
  const keys: string[] = [];
  for (let back = windowMonths - 1; back >= 0; back--) {
    // Date.UTC normalises a negative month into the previous year(s).
    keys.push(monthKey(Date.UTC(year, month - back, 1)));
  }
  return keys;
};
