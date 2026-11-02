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

// How long a detail route's announcement waits for the page to name itself (its data has to come
// in first). A page that names itself later still gets announced, just after its route's title.
const PAGE_NAME_WAIT_MS = 1000;

/**
 * Client-side navigation is silent to screen readers and leaves focus on the clicked link. After
 * each change of page (not a search- or hash-only change, not the first load) this speaks the new
 * page title in a polite live region and, on a link/push navigation, moves focus to the main
 * content without scrolling. Back/forward only announce: they keep the restored scroll position
 * and focus where the browser left it. A route with params is a detail page, whose route title is
 * generic until the shell names the tab after its data (ShellDocumentTitle): while the tab still
 * shows the route's title the announcement waits for that name, and any later change of the title
 * is spoken too. Rendered once, at the root.
 */
export function RouteAnnouncer() {
  const router = useRouter();
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let traversal = false;
    let frame = 0;
    let wait = 0;
    // The page whose title the region follows, and that title. No page until the first navigation.
    let page: string | null = null;
    let title = "";

    const speak = () => {
      const region = regionRef.current;
      if (!region) return;
      region.textContent =
        title ||
        mainContentElement()?.querySelector("h1")?.textContent?.trim() ||
        "";
    };

    const stopHistory = router.history.subscribe(({ action }) => {
      traversal = action.type !== "PUSH" && action.type !== "REPLACE";
    });
    const stopResolved = router.subscribe("onResolved", (event) => {
      if (!event.fromLocation || !event.pathChanged) return;
      const moveFocus = !traversal;
      page = null;
      // Cleared now and filled a frame later, so two pages with the same title still announce.
      if (regionRef.current) regionRef.current.textContent = "";
      cancelAnimationFrame(frame);
      window.clearTimeout(wait);
      // A frame lets the new page's <title> and content land first.
      frame = requestAnimationFrame(() => {
        page = router.state.location.pathname;
        title = document.title;
        const { matches } = router.state;
        const routeTitle = matches
          .flatMap((match) => match.meta ?? [])
          .findLast((meta) => meta?.title)?.title;
        const isDetail = Object.keys(matches.at(-1)?.params ?? {}).length > 0;
        if (isDetail && title === routeTitle) {
          wait = window.setTimeout(speak, PAGE_NAME_WAIT_MS);
        } else {
          speak();
        }
        const main = mainContentElement();
        if (moveFocus && shouldMoveFocus(document.activeElement, main)) {
          focusMainContent({ preventScroll: true });
        }
      });
    });
    // <title> gets replaced, not edited, so this watches the whole head. While a navigation runs
    // the location is already the next page's, so the old page's title changes don't get through.
    const titleObserver = new MutationObserver(() => {
      if (page !== router.state.location.pathname) return;
      if (document.title === title) return;
      title = document.title;
      window.clearTimeout(wait);
      speak();
    });
    titleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      stopHistory();
      stopResolved();
      titleObserver.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(wait);
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
