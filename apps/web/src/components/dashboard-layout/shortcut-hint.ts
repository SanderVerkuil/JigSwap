import { useSyncExternalStore } from "react";

// The command palette opens with Cmd+K or Ctrl+K (command-palette.tsx); the search pill names
// the one the member's keyboard has (UX-158). Apple platforms, iPadOS included (it reports
// "MacIntel"), use the Command key.
export function shortcutHint(platform: string): "⌘K" | "Ctrl K" {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}

type NavigatorWithUAData = Navigator & {
  userAgentData?: { platform?: string };
};

const subscribe = () => () => {};

function getSnapshot() {
  const nav = navigator as NavigatorWithUAData;
  return shortcutHint(nav.userAgentData?.platform || nav.platform || "");
}

// null on the server and during hydration (the platform is unknown there), then the hint.
export function useShortcutHint() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
