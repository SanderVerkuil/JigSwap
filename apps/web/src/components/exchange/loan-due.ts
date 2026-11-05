// When a loan is due back, as whole calendar days. A loan's expected return is a calendar day
// (sent as local midday by the request dialog, see returnByDate), so it is compared by day, never
// as an instant: a loan due today is "due today" until midnight, not overdue from noon.

const MS_PER_DAY = 86_400_000;

const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole local calendar days from `now` to `at`: 0 today, 1 tomorrow, -1 yesterday. */
export const calendarDaysUntil = (at: number, now: Date): number =>
  // Rounded: a day across a daylight-saving change lasts 23 or 25 hours.
  Math.round(
    (startOfLocalDay(new Date(at)) - startOfLocalDay(now)) / MS_PER_DAY,
  );
