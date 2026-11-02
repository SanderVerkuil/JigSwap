import { useEffect, useRef } from "react";

// Radix hands focus back only to its own trigger. A dialog opened by state (from a row, a menu
// item, a page-head button) has none, so closing it leaves focus on <body> and a keyboard user
// back at the top of the page. Set the returned ref to the element that opened the dialog; once
// `open` turns false, focus returns there if it is still on the page. For an opener inside a
// dropdown menu, set the menu's trigger: the item is gone by then.
export function useReturnFocus(open: boolean) {
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [open]);
  return openerRef;
}
