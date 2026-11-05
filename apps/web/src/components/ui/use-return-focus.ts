import { useRef } from "react";

// Radix dialogs return focus only to their own Trigger. Most of ours open from state instead (the
// ⌘K palette, What's new, dropdown-menu items), so on close focus fell to <body> and keyboard users
// started again at the top of the page. These helpers remember what had focus when the dialog
// opened and give it back on close.

const MENU_LABELLED_BY_TRIGGER = '[role="menu"][aria-labelledby]';

/**
 * The element focus should return to, given what was focused when a dialog opened: body or a
 * detached node gives nothing; a menu item gives the button that opened its menu (Radix menus are
 * labelled by their trigger), since the menu closes as the dialog opens.
 */
export function resolveReturnFocusTarget(
  element: Element | null,
): HTMLElement | null {
  let target = element;
  // Each hop leaves a menu for its trigger; a submenu's trigger is an item of its parent menu.
  for (let hop = 0; hop < 5 && target; hop++) {
    const menu = target.closest(MENU_LABELLED_BY_TRIGGER);
    if (!menu) break;
    target = target.ownerDocument.getElementById(
      menu.getAttribute("aria-labelledby") ?? "",
    );
  }
  if (
    !(target instanceof HTMLElement) ||
    !target.isConnected ||
    target === target.ownerDocument.body
  ) {
    return null;
  }
  return target;
}

type AutoFocusHandler = ((event: Event) => void) | undefined;

/**
 * onOpenAutoFocus / onCloseAutoFocus for a Radix dialog-like Content, wrapping the caller's own
 * handlers (which run first and win if they preventDefault). On close, focus goes back to what had
 * it at open, unless that is gone or focus already moved on (e.g. a route change focused the new
 * page): then nothing is stolen.
 */
export function useReturnFocus({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  onOpenAutoFocus?: AutoFocusHandler;
  onCloseAutoFocus?: AutoFocusHandler;
}) {
  const returnTo = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      // Focus has not entered the dialog yet, so this is what opened it.
      returnTo.current = resolveReturnFocusTarget(document.activeElement);
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = returnTo.current;
      returnTo.current = null;
      if (event.defaultPrevented || !target?.isConnected) return;
      // Ours to handle from here: Radix's default would focus a Trigger (often none) or nothing.
      event.preventDefault();
      const active = document.activeElement;
      if (active && active !== document.body) return;
      target.focus({ preventScroll: true });
    },
  };
}
