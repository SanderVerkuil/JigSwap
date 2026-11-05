import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { focusMainContent, mainContentElement } from "./skip-link";

/**
 * Whether a route change should move focus to the new page's main content: when focus is lost
 * (nothing, body, or a node the old page took with it) or still sits outside the main content, in
 * the sidebar, top bar, tab bar or an overlay such as the palette. Focus already in the main
 * content stays, e.g. on the messages inbox row that opened a thread next to the list.
 */
export function shouldMoveFocus(
  active: Element | null,
  main: Element | null,
): boolean {
  if (!main) return false;
  if (!active || !active.isConnected || active === active.ownerDocument.body) {
    return true;
  }
  return !main.contains(active);
}

/**
 * Client-side navigation is silent to screen readers and leaves focus on the clicked link. After
 * each change of page (not a search- or hash-only change, not the first load) this speaks the new
 * page title in a polite live region and, on a link/push navigation, moves focus to the main
 * content without scrolling. Back/forward only announce: they keep the restored scroll position
 * and focus where the browser left it. Rendered once, at the root.
 */
export function RouteAnnouncer() {
  const router = useRouter();
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let traversal = false;
    let frame = 0;
    const stopHistory = router.history.subscribe(({ action }) => {
      traversal = action.type !== "PUSH" && action.type !== "REPLACE";
    });
    const stopResolved = router.subscribe("onResolved", (event) => {
      if (!event.fromLocation || !event.pathChanged) return;
      const moveFocus = !traversal;
      const region = regionRef.current;
      // Cleared now and filled a frame later, so two pages with the same title still announce.
      if (region) region.textContent = "";
      cancelAnimationFrame(frame);
      // A frame lets the new page's <title> and content land first.
      frame = requestAnimationFrame(() => {
        const main = mainContentElement();
        if (region) {
          region.textContent =
            document.title ||
            main?.querySelector("h1")?.textContent?.trim() ||
            "";
        }
        if (moveFocus && shouldMoveFocus(document.activeElement, main)) {
          focusMainContent({ preventScroll: true });
        }
      });
    });
    return () => {
      stopHistory();
      stopResolved();
      cancelAnimationFrame(frame);
    };
  }, [router]);

  return (
    <div
      ref={regionRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-route-announcer=""
    />
  );
}
