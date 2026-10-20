import { useEffect, type RefObject } from "react";

// Horizontal overflow for a tab list that is wider than its container (e.g. People's tabs on a
// phone in Dutch). The list scrolls natively (touch, trackpad, shift+wheel); a vertical mouse
// wheel scrolls it sideways until it reaches an end; the active tab is kept in view; and
// `data-overflow-start` / `data-overflow-end` tell the CSS which edges to fade.

// How much of the neighbouring tab stays visible beside a revealed tab, so it reads as "more".
export const REVEAL_MARGIN_PX = 32;

export type ScrollMetrics = {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
};

// Sub-pixel layouts can leave a fraction of a pixel of "overflow": not worth a fade.
const EPSILON = 1;

export function overflowEdges({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: ScrollMetrics): { start: boolean; end: boolean } {
  return {
    start: scrollLeft > EPSILON,
    end: scrollLeft + clientWidth < scrollWidth - EPSILON,
  };
}

// The scrollLeft that brings [itemStart, itemEnd] (in the list's scroll coordinates) into view
// with `margin` to spare, moving as little as possible; the current scrollLeft if it already fits.
export function scrollLeftToReveal(
  metrics: ScrollMetrics,
  itemStart: number,
  itemEnd: number,
  margin = REVEAL_MARGIN_PX,
): number {
  const { scrollLeft, clientWidth, scrollWidth } = metrics;
  const max = Math.max(0, scrollWidth - clientWidth);
  let next = scrollLeft;
  if (itemStart - margin < scrollLeft) {
    next = itemStart - margin;
  } else if (itemEnd + margin > scrollLeft + clientWidth) {
    next = itemEnd + margin - clientWidth;
  }
  return Math.min(max, Math.max(0, next));
}

// A vertical wheel over an overflowing list scrolls it sideways, as long as it can still move in
// that direction; at either end (or for a horizontal gesture, which scrolls natively) it returns
// null and the page scrolls as usual.
export function wheelScrollDelta(
  metrics: ScrollMetrics,
  deltaX: number,
  deltaY: number,
): number | null {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  const { start, end } = overflowEdges(metrics);
  if (deltaY > 0 && !end) return null;
  if (deltaY < 0 && !start) return null;
  return deltaY;
}

const metricsOf = (el: HTMLElement): ScrollMetrics => ({
  scrollLeft: el.scrollLeft,
  clientWidth: el.clientWidth,
  scrollWidth: el.scrollWidth,
});

export function useScrollableTabsList(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const markEdges = () => {
      const { start, end } = overflowEdges(metricsOf(el));
      el.toggleAttribute("data-overflow-start", start);
      el.toggleAttribute("data-overflow-end", end);
    };

    const revealActive = (smooth: boolean) => {
      const active = el.querySelector<HTMLElement>(
        '[role="tab"][data-state="active"]',
      );
      if (!active) return;
      const listBox = el.getBoundingClientRect();
      const tabBox = active.getBoundingClientRect();
      const itemStart = tabBox.left - listBox.left + el.scrollLeft;
      const next = scrollLeftToReveal(
        metricsOf(el),
        itemStart,
        itemStart + tabBox.width,
      );
      if (next === el.scrollLeft) return;
      const reduceMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      el.scrollTo({
        left: next,
        behavior: smooth && !reduceMotion ? "smooth" : "auto",
      });
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // pinch-zoom
      const delta = wheelScrollDelta(metricsOf(el), event.deltaX, event.deltaY);
      if (delta === null) return;
      event.preventDefault();
      el.scrollLeft += delta;
    };

    revealActive(false);
    markEdges();

    el.addEventListener("scroll", markEdges, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            revealActive(false);
            markEdges();
          });
    resize?.observe(el);
    // The active trigger flips data-state on every tab change, by click, keyboard or URL.
    const mutations = new MutationObserver(() => {
      revealActive(true);
      markEdges();
    });
    mutations.observe(el, {
      subtree: true,
      childList: true,
      attributeFilter: ["data-state"],
    });

    return () => {
      el.removeEventListener("scroll", markEdges);
      el.removeEventListener("wheel", onWheel);
      resize?.disconnect();
      mutations.disconnect();
    };
  }, [ref]);
}
