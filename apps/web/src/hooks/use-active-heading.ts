import * as React from "react";

// A heading counts as reached once its top is this close to the top of the window. An anchor
// jump parks it at 90 to 128px (the header, the phone Docs bar and a small gap), always above
// this line, and the next heading starts below it.
const READ_LINE = 140;

// Which section of a long page the reader is in, for its contents list: the last one whose top
// has reached the top of the window. A section picked from the list stays current while the reader
// stays where the jump landed or reads on down, until it leaves the window, so a short section, or
// one too near the end of the page to scroll up that far, still lights the link that was clicked.
// Scrolling back up lets go of it straight away.
export function useActiveHeading(items: readonly { id: string }[]) {
  const [active, setActive] = React.useState(items[0]?.id);
  // The picked section, and where its top was on the last frame.
  const picked = React.useRef<{ id: string; top: number } | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const topOf = (id: string) =>
      document.getElementById(id)?.getBoundingClientRect().top;
    let frame = 0;
    const update = () => {
      frame = 0;
      const pick = picked.current;
      const pickedTop = pick && topOf(pick.id);
      if (
        pick &&
        pickedTop !== undefined &&
        pickedTop >= 0 &&
        pickedTop < window.innerHeight &&
        pickedTop <= pick.top + 2
      ) {
        pick.top = pickedTop;
        return;
      }
      picked.current = undefined;
      let current = items[0]?.id;
      for (const { id } of items) {
        const top = topOf(id);
        if (top === undefined) continue;
        if (top > READ_LINE) break;
        current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items]);

  const pick = React.useCallback((id: string) => {
    // Where the jump lands is only known on the frame after it.
    picked.current = { id, top: Infinity };
    setActive(id);
  }, []);

  return [active, pick] as const;
}

// How far a rail keeps its current entry from its own top and bottom edges.
const RAIL_MARGIN = 24;

// A contents rail that scrolls on its own (a long list on a short window) keeps its current entry
// in view as the reader moves through the page. Only the rail scrolls, never the page, and only as
// far as it has to. The first entry takes the rail back to its top, so the rail's own title above
// it isn't left cut in half. A hidden rail (below its breakpoint) has no box and is left alone.
export function useRailFollowsActive(
  rail: React.RefObject<HTMLElement | null>,
  active: string | undefined,
) {
  React.useLayoutEffect(() => {
    const box = rail.current;
    const entry = box?.querySelector('[aria-current="true"]');
    if (!box || !entry) return;
    const view = box.getBoundingClientRect();
    if (view.height === 0) return;
    if (entry === box.querySelector("a")) {
      box.scrollTo({ top: 0 });
      return;
    }
    const { top, bottom } = entry.getBoundingClientRect();
    const above = view.top + RAIL_MARGIN - top;
    const below = bottom - (view.bottom - RAIL_MARGIN);
    if (above > 0) box.scrollBy({ top: -above });
    else if (below > 0) box.scrollBy({ top: below });
  }, [rail, active]);
}

// A click that follows the link in this tab. With a modifier key or another button the browser
// opens it elsewhere, so this page doesn't jump and the list shouldn't change.
export const isPlainClick = (e: React.MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
