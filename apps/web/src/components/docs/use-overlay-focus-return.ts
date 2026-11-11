import { focusHashTarget } from "@/components/a11y/skip-link";
import * as React from "react";

// Hands focus back when a docs overlay closes. Radix only returns focus to a
// Trigger, and these overlays have none because several controls open them (the
// hero search box, the docs bar, the sidebar, ⌘K), so closing one would drop
// focus to <body>. Spread the result on the overlays' content elements. They
// share one hook because the navigation sheet can hand over to search: the
// control that opened the sheet is then the one to come back to. An overlay
// that closed on its way to another page (a search pick, a link in the sheet)
// leaves focus to the route change, which moves it to the new page's main
// content; the opener belongs to the page that was left. A search pick on the
// same page moves only the hash: focus goes to that section, as the route
// change would have sent it.
export function useOverlayFocusReturn() {
  const openerRef = React.useRef<HTMLElement | null>(null);
  const openedOnRef = React.useRef({ pathname: "", hash: "" });
  return React.useMemo(
    () => ({
      // Runs before the overlay takes focus, so this is still the opener, unless
      // the sheet is handing over to search: focus is then inside the sheet, or
      // already gone with it, and the sheet's opener stays the one to return to.
      onOpenAutoFocus: () => {
        openedOnRef.current = {
          pathname: window.location.pathname,
          hash: window.location.hash,
        };
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active !== document.body &&
          !active.closest('[role="dialog"]')
        ) {
          openerRef.current = active;
        }
      },
      onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        // The sheet finishing its exit after handing over to search: search owns
        // focus until it closes.
        if (document.querySelector('[role="dialog"]')) return;
        const { pathname, hash } = window.location;
        const opened = openedOnRef.current;
        // The opener, without scrolling: ⌘K can open search while focus sits
        // on a control scrolled out of view, and closing shouldn't jump the
        // page back to it.
        if (
          pathname === opened.pathname &&
          (hash === opened.hash ||
            !focusHashTarget(hash, { preventScroll: true }))
        ) {
          openerRef.current?.focus({ preventScroll: true });
        }
        openerRef.current = null;
      },
    }),
    [],
  );
}
