import { useCallback } from "react";
import { useFormatter, useNow } from "use-intl";

// Relative times ("3 minutes ago") always format against an explicit `now`:
// without one use-intl falls back to the environment clock and reports
// ENVIRONMENT_FALLBACK, and SSR/hydration can disagree. useNow starts from the
// IntlProvider's server-provided `now` (so hydration matches) and ticks once a
// minute so long-lived pages stay current.
export const RELATIVE_TIME_UPDATE_INTERVAL_MS = 60_000;

export function useRelativeTime(): (date: Date | number) => string {
  const format = useFormatter();
  const now = useNow({ updateInterval: RELATIVE_TIME_UPDATE_INTERVAL_MS });
  return useCallback(
    (date: Date | number) => format.relativeTime(date, now),
    [format, now],
  );
}

// For things that already happened. The clock above lags by up to a tick, so an event from seconds
// ago can be ahead of it: that reads "now", never "in 30 seconds". Not for times that may really lie
// ahead (a retry-at); those keep useRelativeTime.
export function useElapsedTime(): (date: Date | number) => string {
  const format = useFormatter();
  const now = useNow({ updateInterval: RELATIVE_TIME_UPDATE_INTERVAL_MS });
  return useCallback(
    (date: Date | number) =>
      format.relativeTime(
        Math.min(new Date(date).getTime(), now.getTime()),
        now,
      ),
    [format, now],
  );
}
