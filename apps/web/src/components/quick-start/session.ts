"use client";

import { safeStorage } from "@/lib/safe-storage";
import { useEffect, useSyncExternalStore } from "react";

// The one per-session quick start key (spec §2.3): "1" once the card or the /welcome flow was
// on screen this session (so the one-row "all set up" state may show), "hidden" after the
// member hid that row. A new browser session starts empty, so the row is gone next time.
const SESSION_KEY = "jigswap.quickStart.doneShown";

const noopSubscribe = () => () => {};

/** The key's value; null on the server and the first client render (no hydration mismatch). */
export function useQuickStartSession(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => safeStorage.getItem("session", SESSION_KEY),
    () => null,
  );
}

/** Marks the quick start as used this session while `active`, unless the member hid it. */
export function useMarkQuickStartUsed(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (safeStorage.getItem("session", SESSION_KEY) === "hidden") return;
    safeStorage.setItem("session", SESSION_KEY, "1");
  }, [active]);
}

export function markQuickStartHidden(): void {
  safeStorage.setItem("session", SESSION_KEY, "hidden");
}
