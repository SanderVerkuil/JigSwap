"use client";

import { useEffect, useSyncExternalStore } from "react";

// The shell's "surface busy" signal (spec §A6): higher-priority surfaces report while they are on
// screen or about to be. The highlight modal checks it at the moment it would open and otherwise
// waits for the next route change; the install tip follows it live (useSurfaceBusy), because it can
// already be up when a surface claims the bottom of the screen without any navigation.
const busy = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Report `key` as busy while `active` (e.g. a prompt's dialog is open or its save is in flight). */
export function useReportSurfaceBusy(key: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    busy.add(key);
    notify();
    return () => {
      busy.delete(key);
      notify();
    };
  }, [key, active]);
}

export function isSurfaceBusy(): boolean {
  return busy.size > 0;
}

/** isSurfaceBusy, re-rendering when it changes. Never busy on the server or at hydration. */
export function useSurfaceBusy(): boolean {
  return useSyncExternalStore(subscribe, isSurfaceBusy, () => false);
}

/** Any Radix dialog or sheet (solve dialogs, quick sheet, command palette, …) is open. */
export function isAnyDialogOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector('[role="dialog"][data-state="open"]') !== null
  );
}
