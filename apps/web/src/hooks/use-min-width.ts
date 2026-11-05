import { useCallback, useSyncExternalStore } from "react";

// Whether the viewport is at least `width` wide, as a CSS `min-width` media query, so it flips
// exactly where the Tailwind breakpoint of the same width does (pass the breakpoint's own value,
// e.g. "64rem" for lg). The server (and hydration) snapshot is "wide", the desktop layout; the
// client snapshot takes over right after hydration and on every crossing (same shape as
// use-mobile.ts).
export function useMinWidth(width: string): boolean {
  const query = `(min-width: ${width})`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const getServerSnapshot = () => true;
