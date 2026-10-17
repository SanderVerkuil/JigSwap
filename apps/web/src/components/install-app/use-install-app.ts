"use client";

import { getPostHog } from "@/lib/analytics-client";
import {
  getInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/install-prompt";
import { safeStorage } from "@/lib/safe-storage";
import { useSyncExternalStore } from "react";
import {
  installMethod,
  isStandalone,
  parseTipState,
  type InstallMethod,
  type TipState,
} from "./logic";

const STATE_KEY = "jigswap.installTip";
const noopSubscribe = () => () => {};

export function readTipState(): TipState {
  return parseTipState(safeStorage.getItem("local", STATE_KEY));
}

export function writeTipState(state: TipState): void {
  safeStorage.setItem("local", STATE_KEY, JSON.stringify(state));
}

function readStandalone(): boolean {
  return isStandalone({
    displayModeStandalone: window.matchMedia("(display-mode: standalone)")
      .matches,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean })
      .standalone,
  });
}

/**
 * How this browser can install JigSwap, or null (already installed, unsupported, or SSR / the
 * first client render, so markup matches hydration). Re-renders when a Chromium install prompt
 * arrives or is used up.
 */
export function useInstallMethod(): InstallMethod | null {
  const hasPrompt = useSyncExternalStore(
    subscribeInstallPrompt,
    () => getInstallPrompt() !== null,
    () => false,
  );
  const client = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!client || readStandalone()) return null;
  return installMethod({
    traits: {
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    },
    hasPrompt,
  });
}

// ---- "Show the tip now" requests from the quick sheet entry --------------------------------

let requested = false;
const requestListeners = new Set<() => void>();
const setRequested = (value: boolean) => {
  requested = value;
  for (const listener of requestListeners) listener();
};

export function requestInstallTip(): void {
  setRequested(true);
}

export function clearInstallTipRequest(): void {
  setRequested(false);
}

export function useInstallTipRequested(): boolean {
  return useSyncExternalStore(
    (listener) => {
      requestListeners.add(listener);
      return () => requestListeners.delete(listener);
    },
    () => requested,
    () => false,
  );
}

// ---- Install + analytics -------------------------------------------------------------------

type InstallEvent =
  "install_tip_shown" | "install_tip_dismissed" | "install_accepted";

/** No-op unless PostHog is loaded (consent given and the lazy chunk arrived). */
export function trackInstall(
  event: InstallEvent,
  properties: Record<string, string>,
): void {
  getPostHog()?.capture(event, properties);
}

/** Runs the Chromium install dialog; resolves true when the member accepted. */
export async function runInstallPrompt(
  source: "tip" | "menu",
): Promise<boolean> {
  try {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      trackInstall("install_accepted", { method: "prompt", source });
      return true;
    }
  } catch (error) {
    console.error("Install prompt failed:", error);
  }
  return false;
}
