"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { safeStorage } from "@/lib/safe-storage";
import { useCallback, useSyncExternalStore } from "react";
import { PICK_LIMIT, type Pick } from "./selection";

// The picker's tray, up to PICK_LIMIT picks a member may have spent a while on. It outlives the
// picker: "Register" leaves for the full add form and comes back, so the tray lives here rather than
// in component state, kept in sessionStorage so a reload keeps it too. In memory as well, because
// storage can be blocked (private mode, in-app browsers). One slot per tab, marked with its owner: a
// tray never shows to another member signing in in the same tab.

const STORAGE_KEY = "jigswap.cataloguePicker.tray";
const EMPTY: readonly Pick[] = [];

interface Tray {
  owner?: string;
  picks: readonly Pick[];
}

const asPick = (value: unknown): Pick | null => {
  if (typeof value !== "object" || value === null) return null;
  const { definitionId, title, pending, forTrade, forLend } =
    value as Partial<Pick>;
  if (typeof definitionId !== "string" || typeof title !== "string") {
    return null;
  }
  return {
    definitionId,
    title,
    pending: pending === true,
    forTrade: forTrade === true,
    forLend: forLend === true,
  };
};

/** The stored tray, ignoring anything that isn't one (an older shape, a hand-edited value). */
export function parseTray(raw: string | null): Tray {
  if (!raw) return { picks: EMPTY };
  try {
    const { owner, picks } = JSON.parse(raw) as {
      owner?: unknown;
      picks?: unknown;
    };
    return {
      owner: typeof owner === "string" ? owner : undefined,
      picks: Array.isArray(picks)
        ? picks
            .map(asPick)
            .filter((pick): pick is Pick => pick !== null)
            .slice(0, PICK_LIMIT)
        : EMPTY,
    };
  } catch {
    return { picks: EMPTY };
  }
}

// Read from storage once, on the first look in this page load.
let tray: Tray | null = null;
const listeners = new Set<() => void>();

const currentTray = (): Tray =>
  (tray ??= parseTray(safeStorage.getItem("session", STORAGE_KEY)));

const writeTray = (next: Tray) => {
  tray = next;
  if (next.picks.length === 0) safeStorage.removeItem("session", STORAGE_KEY);
  else safeStorage.setItem("session", STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
};

const picksFor = (memberId: string | undefined): readonly Pick[] => {
  const { owner, picks } = currentTray();
  return owner && memberId && owner !== memberId ? EMPTY : picks;
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Empties the tray: its picks were discarded on purpose. */
export function clearPickTray() {
  writeTray({ picks: EMPTY });
}

/** The tray for the signed-in member. Empty on the server and at hydration (storage is the client's). */
export function usePickTray() {
  const { member } = useCurrentMember();
  const memberId = member?._id;
  const picks = useSyncExternalStore(
    subscribe,
    () => picksFor(memberId),
    () => EMPTY,
  );
  const update = useCallback(
    (change: (current: readonly Pick[]) => readonly Pick[]) => {
      const current = picksFor(memberId);
      const next = change(current);
      if (next !== current) writeTray({ owner: memberId, picks: next });
    },
    [memberId],
  );
  return { picks, update };
}

// The one page the tray is left for on purpose, and comes back from: "Register" in the picker.
export const trayOutlivesLeavingTo = (pathname: string) =>
  /^\/my-puzzles\/add\/new\/?$/.test(pathname);
