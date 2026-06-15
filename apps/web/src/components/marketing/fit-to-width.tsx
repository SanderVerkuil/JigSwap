"use client";

import * as React from "react";

/**
 * Largest scale ≤ 1 that fits a child of `naturalWidth` into `containerWidth`.
 * Only ever scales DOWN — equal/larger containers return 1 (render untouched).
 * Returns 1 for non-positive inputs (pre-measurement / unmeasured elements).
 */
export function fitScale(containerWidth: number, naturalWidth: number): number {
  if (containerWidth <= 0 || naturalWidth <= 0) return 1;
  return Math.min(1, containerWidth / naturalWidth);
}

/**
 * Scales a fixed-size child DOWN to fit the width of this wrapper, and collapses
 * the wrapper's rendered height to the scaled height so the shrunk child leaves
 * no layout gap. `overflow: hidden` contains the child's un-transformed layout
 * box (a CSS transform shrinks paint, not layout) so it can't widen the page.
 *
 * Used for the marketing JigPlank previews, which are intrinsically wider than a
 * phone viewport. At widths ≥ the child's natural width, scale is 1 (untouched).
 */
export function FitToWidth({ children }: { children: React.ReactNode }) {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [scaledHeight, setScaledHeight] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const outerEl = outer.current;
    const innerEl = inner.current;
    if (!outerEl || !innerEl) return;

    const measure = () => {
      // offsetWidth/Height report the UN-transformed layout box, so they give the
      // child's natural size even while our scale transform is applied.
      const next = fitScale(outerEl.clientWidth, innerEl.offsetWidth);
      setScale(next);
      setScaledHeight(innerEl.offsetHeight * next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outerEl);
    ro.observe(innerEl); // child can resize after images load (JigPlank re-measures)
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outer}
      style={{
        width: "100%",
        height: scaledHeight ?? undefined,
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        ref={inner}
        style={{
          flex: "none",
          transform: `scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
