import { useCallback } from "react";

// Sticky bars inside the page (a page's tab bar) stick just below the shell's own sticky chrome:
// the mobile top bar below md, the desktop page head from md up. Both change height (safe-area
// inset, breadcrumb row, wrapping title), so each publishes its measured height as a CSS variable
// on <html>, and the shell's scroll region turns the right one into --app-sticky-top.
export const MOBILE_TOP_BAR_HEIGHT_VAR = "--mobile-top-bar-height";
export const PAGE_HEAD_HEIGHT_VAR = "--page-head-height";

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
