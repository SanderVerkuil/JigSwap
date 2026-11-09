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

// A click that follows the link in this tab. With a modifier key or another button the browser
// opens it elsewhere, so this page doesn't jump and the list shouldn't change.
export const isPlainClick = (e: React.MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
