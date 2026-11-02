import { calendarDaysAgo } from "@/lib/date-input";
import { useState } from "react";
import { useTranslations } from "use-intl";

// "Started today" / "Started 3 days ago" for an in-progress solve. Its start is a calendar date
// (stored as UTC midnight), so this counts calendar days to the member's local today: a relative
// time would treat it as an exact instant and read "22 hours ago". A future start reads "Starts in
// N days", never "-N days ago". `now` is captured once per mount (impure during render otherwise).
export function useStartedLabel(): (startDate: number) => string {
  const t = useTranslations("dashboard.solvingNow");
  const [now] = useState(() => Date.now());
  return (startDate) => {
    const days = calendarDaysAgo(startDate, new Date(now));
    if (days < 0) return t("startsInDays", { days: -days });
    if (days === 0) return t("startedToday");
    return t("startedDaysAgo", { days });
  };
}
