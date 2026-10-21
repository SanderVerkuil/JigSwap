"use client";

// The thread list's "active" background as one element that slides from row
// to row when the open conversation changes, instead of each row painting
// its own. It sits inside the list (so it scrolls with it), behind the rows,
// and follows the row marked aria-current="page".
import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";

export type RowBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function sameBox(a: RowBox | null, b: RowBox | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.top === b.top &&
      a.left === b.left &&
      a.width === b.width &&
      a.height === b.height)
  );
}

/**
 * Slide only from a place the member could see: not on first paint, and not
 * when the previously active row was scrolled out of the list's viewport.
 */
export function shouldSlide(
  previous: { top: number; bottom: number } | null,
  viewport: { top: number; bottom: number },
): boolean {
  return (
    previous !== null &&
    previous.bottom > viewport.top &&
    previous.top < viewport.bottom
  );
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

function measureActiveRow(container: HTMLElement): RowBox | null {
  const row = container.querySelector<HTMLElement>('[aria-current="page"]');
  // Offsets are relative to the container, the rows' positioned ancestor.
  return row
    ? {
        top: row.offsetTop,
        left: row.offsetLeft,
        width: row.offsetWidth,
        height: row.offsetHeight,
      }
    : null;
}

/**
 * Render as the first child of the positioned (`relative`) element holding the
 * rows. `activeKey` is the open thread; `layoutKey` changes whenever rows
 * reorder, so the indicator follows its row.
 */
export function ActiveRowIndicator({
  activeKey,
  layoutKey,
}: {
  activeKey: string | undefined;
  layoutKey: string;
}) {
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<RowBox | null>(null);
  const [slide, setSlide] = useState(false);
  // The position currently on screen, for the effects to compare against.
  const shownBox = useRef<RowBox | null>(null);

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const container = indicator?.parentElement;
    if (!indicator || !container) return;
    const next = measureActiveRow(container);
    // The indicator still stands on the previous row here: was it visible?
    const previous = shownBox.current
      ? indicator.getBoundingClientRect()
      : null;
    const viewport = scrollParent(container)?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    shownBox.current = next;
    setSlide(next !== null && shouldSlide(previous, viewport));
    setBox(next);
  }, [activeKey, layoutKey]);

  // Width or font changes move rows without a navigation: follow them
  // without sliding.
  useLayoutEffect(() => {
    const container = indicatorRef.current?.parentElement;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = measureActiveRow(container);
      if (sameBox(shownBox.current, next)) return;
      shownBox.current = next;
      setSlide(false);
      setBox(next);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={indicatorRef}
      aria-hidden
      className={cn(
        "bg-jigsaw-primary-tint pointer-events-none absolute top-0 left-0 rounded-lg max-md:hidden",
        slide &&
          "transition-[transform,height] duration-[220ms] ease-out motion-reduce:transition-none",
        !box && "invisible",
      )}
      style={
        box
          ? {
              transform: `translateY(${box.top}px)`,
              left: box.left,
              width: box.width,
              height: box.height,
            }
          : undefined
      }
    >
      <span className="bg-primary absolute inset-y-3 left-0 w-[3px] rounded-full" />
    </span>
  );
}
