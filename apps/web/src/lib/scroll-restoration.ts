// Router scroll options, shared by the router and the dashboard shell.
//
// On desktop the dashboard shell scrolls an inner region, not the window.
// TanStack Router only resets the window on navigation; any other element it
// saw scroll keeps its position on the next route unless it is listed in
// `scrollToTopSelectors`. Tagging the region with `data-scroll-restoration-id`
// also gives it a stable restoration key, so back/forward restores it.
export const APP_SCROLL_REGION_ID = "app-content";

export const appScrollRestoration = {
  scrollRestoration: true,
  scrollToTopSelectors: [
    `[data-scroll-restoration-id="${APP_SCROLL_REGION_ID}"]`,
  ],
};

// A link to the page you are already on is a same-location navigation: the
// router keeps the history entry and restores the position it saved for it, so
// the tap leaves the page where it was. On a phone the tab bar follows the
// app convention instead: tapping the tab you're on goes back to the top.
// Skip that no-op navigation and scroll the document (phones scroll the
// document, not the app-content region) to the top.
export function scrollToTopIfCurrent(
  event: { preventDefault: () => void },
  currentHref: string,
  href: string,
) {
  if (currentHref !== href) return;
  event.preventDefault();
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}
