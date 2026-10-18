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
