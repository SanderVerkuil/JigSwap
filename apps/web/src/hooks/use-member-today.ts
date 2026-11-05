import { localTodayMs, zonedTodayMs } from "@/lib/date-input";
import { useCallback, useSyncExternalStore } from "react";
import { useNow, useTimeZone } from "use-intl";

const noopSubscribe = () => () => {};

/**
 * Today's calendar date (UTC midnight, see lib/date-input) for anything a server-rendered page derives
 * from "today". Member-facing, it is the member's local calendar. The server doesn't know that one and
 * its own runtime is usually on another day for hours around midnight, so the server and the first
 * client render use the IntlProvider's instant in the app's time zone, and React swaps in the local
 * day right after hydration. Read it here, never from the runtime's date getters during render.
 */
export function useMemberToday(): number {
  const now = useNow();
  const timeZone = useTimeZone();
  const serverToday = useCallback(
    () => zonedTodayMs(now, timeZone),
    [now, timeZone],
  );
  return useSyncExternalStore(noopSubscribe, localTodayMs, serverToday);
}
