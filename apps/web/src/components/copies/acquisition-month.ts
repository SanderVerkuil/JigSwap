// "Acquired" is recorded as a month and year (the copy page shows "Mar 2025"), but stored as an
// instant (ownedPuzzles.acquisitionDate). A picked month is stored as noon UTC on its first day,
// which falls on the 1st of that month in every time zone (UTC-12 to UTC+14), so reading it back
// in the app's time zone gives the same month.

export interface AcquisitionMonth {
  year: number;
  /** 1–12. */
  month: number;
}

export const acquisitionMonthStart = (year: number, month: number): number =>
  Date.UTC(year, month - 1, 1, 12);

// null when the timestamp isn't a real date, which the backend refuses to store but formatToParts
// would throw on: the Edit dialog reads this during render, even while closed.
export const acquisitionMonthOf = (
  timestamp: number,
  timeZone: string,
): AcquisitionMonth | null => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const part = (type: "year" | "month") =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month") };
};
