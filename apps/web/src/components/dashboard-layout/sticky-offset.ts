import { useCallback } from "react";

// Sticky bars inside the page (a page's tab bar) stick just below the shell's own sticky chrome:
// the mobile top bar below md, the desktop page head from md up. Both change height (safe-area
// inset, breadcrumb row, wrapping title), so each publishes its measured height as a CSS variable
// on <html>, and the shell's scroll region turns the right one into --app-sticky-top.
export const MOBILE_TOP_BAR_HEIGHT_VAR = "--mobile-top-bar-height";
export const PAGE_HEAD_HEIGHT_VAR = "--page-head-height";
// The same for the phone's bottom tab bar, which grows by the home-indicator inset in the
// installed app: what docks above it (toasts, the install tip, the quick-start footer) reads this
// instead of a hard-coded 57px. 0px from md up (the bar is display:none there) and unset where the
// bar isn't rendered (an open thread, public pages), so `var(..., 0px)` means "no bar".
export const MOBILE_TAB_BAR_HEIGHT_VAR = "--mobile-tab-bar-height";
// How far the tab bar's raised "+" reaches above the bar's top edge: its -mt-[22px] lifts the
// 52px button 8px out of the centred 56px row, plus its 4px ring. Keep in sync with MobileTabBar.
export const MOBILE_TAB_BAR_RAISE = "12px";
// While the cookie banner is open it floats over the bottom of every page. It publishes the strip
// of the viewport it covers above the tab bar (its height, plus its gap over the bar on phones),
// so the page pads its end by that much and scrolls focused controls clear of it. Unset while the
// banner is closed, so `var(..., 0px)` means "no banner".
export const CONSENT_BANNER_HEIGHT_VAR = "--consent-banner-height";

// A callback ref that keeps `name` equal to the element's border-box height while it is mounted,
// and removes the variable when it unmounts (e.g. the mobile top bar on an immersive route).
export function useHeightCssVar(name: string) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const root = document.documentElement;
      const publish = () =>
        root.style.setProperty(
          name,
          `${node.getBoundingClientRect().height}px`,
        );
      publish();
      const observer =
        typeof ResizeObserver === "undefined"
          ? undefined
          : new ResizeObserver(publish);
      observer?.observe(node);
      return () => {
        observer?.disconnect();
        root.style.removeProperty(name);
      };
    },
    [name],
  );
}
