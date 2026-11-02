import * as React from "react";

// Hands focus back when a docs overlay closes. Radix only returns focus to a
// Trigger, and these overlays have none because several controls open them (the
// hero search box, the docs bar, the sidebar, ⌘K), so closing one would drop
// focus to <body>. Spread the result on the overlays' content elements. They
// share one hook because the navigation sheet can hand over to search: the
// control that opened the sheet is then the one to come back to.
export function useOverlayFocusReturn() {
  const openerRef = React.useRef<HTMLElement | null>(null);
  return React.useMemo(
    () => ({
      // Runs before the overlay takes focus, so this is still the opener, unless
      // the sheet is handing over to search: focus is then inside the sheet, or
      // already gone with it, and the sheet's opener stays the one to return to.
      onOpenAutoFocus: () => {
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
        openerRef.current?.focus();
        openerRef.current = null;
      },
    }),
    [],
  );
}
