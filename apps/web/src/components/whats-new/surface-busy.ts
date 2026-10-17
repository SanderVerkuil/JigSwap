"use client";

import { useEffect } from "react";

// The shell's "surface busy" signal (spec §A6): higher-priority surfaces report while they are on
// screen or about to be, and the highlight modal checks it before opening. A plain module store
// is enough because nothing re-renders on it: the modal only reads it at the moment it would open
// and otherwise waits for the next route change.
const busy = new Set<string>();

/** Report `key` as busy while `active` (e.g. a prompt's dialog is open or its save is in flight). */
export function useReportSurfaceBusy(key: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    busy.add(key);
    return () => {
      busy.delete(key);
    };
  }, [key, active]);
}

export function isSurfaceBusy(): boolean {
  return busy.size > 0;
}

/** Any Radix dialog or sheet (solve dialogs, quick sheet, command palette, …) is open. */
export function isAnyDialogOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector('[role="dialog"][data-state="open"]') !== null
  );
}
