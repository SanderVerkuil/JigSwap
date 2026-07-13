"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Side-panel hover zoom (e-commerce "product zoom"): hovering the image shows a lens over the
// region under the cursor and a floating result panel — portalled to <body> so it escapes any
// `overflow-hidden` / clipping ancestor — that renders that region magnified. Pointer-only: on
// coarse pointers (touch) it degrades to a plain <img> with no lens/panel.
//
// object-contain aware: geometry is computed from the image's *rendered* (letterboxed) rect, so it
// works both for a `fill` cover in a square box and for an intrinsically-sized image in a lightbox.

type Active = {
  // Lens rectangle, in px relative to the wrapper.
  lens: { left: number; top: number; width: number; height: number };
  // Result panel, position:fixed in viewport px + the background it paints.
  panel: {
    left: number;
    top: number;
    width: number;
    height: number;
    backgroundSize: string;
    backgroundPosition: string;
  };
};

export function ImageZoom({
  src,
  alt,
  zoom = 2.5,
  panelSize = 360,
  fill = false,
  className,
  wrapperClassName,
}: {
  src: string;
  alt: string;
  /** Magnification of the result panel relative to the displayed image. */
  zoom?: number;
  /** Result panel edge length in px (square). */
  panelSize?: number;
  /** Fill a positioned parent (absolute inset-0) — for cover images in an aspect box. */
  fill?: boolean;
  /** Extra classes on the <img>. */
  className?: string;
  /** Extra classes on the relative wrapper. */
  wrapperClassName?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState<Active | null>(null);

  // Enable the zoom only for fine pointers (mouse/trackpad). matchMedia is read in an effect so it
  // stays SSR-safe, and re-checks on change (e.g. a 2-in-1 switching input modes).
  const [finePointer, setFinePointer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const sync = () => setFinePointer(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const clear = () => setActive(null);

  const onMove = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    const wrapper = wrapperRef.current;
    if (!img || !wrapper) return;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (!natW || !natH) return; // not decoded yet

    const box = img.getBoundingClientRect();
    // Rendered (object-contain) image rect inside the img box: letterboxed on the shorter axis.
    const scale = Math.min(box.width / natW, box.height / natH);
    const renderedW = natW * scale;
    const renderedH = natH * scale;
    const offsetX = (box.width - renderedW) / 2;
    const offsetY = (box.height - renderedH) / 2;

    // Cursor position within the rendered image (px from its top-left).
    const px = e.clientX - box.left - offsetX;
    const py = e.clientY - box.top - offsetY;
    // Outside the actual picture (in the letterbox margin) → no zoom.
    if (px < 0 || py < 0 || px > renderedW || py > renderedH) {
      clear();
      return;
    }
    const fx = px / renderedW;
    const fy = py / renderedH;

    // Lens covers exactly the area the panel magnifies: panel/zoom, in rendered px.
    const lensW = Math.min(panelSize / zoom, renderedW);
    const lensH = Math.min(panelSize / zoom, renderedH);
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));
    const lensCx = clamp(px, lensW / 2, renderedW - lensW / 2);
    const lensCy = clamp(py, lensH / 2, renderedH - lensH / 2);
    const wrapRect = wrapper.getBoundingClientRect();
    const lensLeft = box.left + offsetX + lensCx - lensW / 2 - wrapRect.left;
    const lensTop = box.top + offsetY + lensCy - lensH / 2 - wrapRect.top;

    // Background: paint the whole rendered image scaled by `zoom`, positioned so the point under the
    // cursor sits at the panel centre (clamped so the panel never shows past the image edges).
    const bgW = renderedW * zoom;
    const bgH = renderedH * zoom;
    const posX = clamp(panelSize / 2 - fx * bgW, panelSize - bgW, 0);
    const posY = clamp(panelSize / 2 - fy * bgH, panelSize - bgH, 0);

    // Place the panel beside the image: to the right if it fits, else to the left, else clamp.
    const gap = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let panelLeft = box.right + gap;
    if (panelLeft + panelSize > vw - 8) panelLeft = box.left - gap - panelSize;
    if (panelLeft < 8) panelLeft = Math.max(8, vw - panelSize - 8);
    const panelTop = clamp(box.top, 8, Math.max(8, vh - panelSize - 8));

    setActive({
      lens: { left: lensLeft, top: lensTop, width: lensW, height: lensH },
      panel: {
        left: panelLeft,
        top: panelTop,
        width: panelSize,
        height: panelSize,
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${posX}px ${posY}px`,
      },
    });
  };

  return (
    <div
      ref={wrapperRef}
      className={cn(fill ? "absolute inset-0" : "relative", wrapperClassName)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        decoding="async"
        className={cn(
          fill && "h-full w-full object-contain",
          finePointer && "cursor-zoom-in",
          className,
        )}
        onMouseMove={finePointer ? onMove : undefined}
        onMouseLeave={clear}
      />

      {active && (
        <span
          aria-hidden
          className="border-jigsaw-primary/70 pointer-events-none absolute border bg-white/20"
          style={{
            left: active.lens.left,
            top: active.lens.top,
            width: active.lens.width,
            height: active.lens.height,
          }}
        />
      )}

      {active &&
        createPortal(
          <div
            aria-hidden
            className="border-border pointer-events-none fixed z-[100] overflow-hidden rounded-xl border bg-white bg-no-repeat shadow-2xl dark:bg-neutral-900"
            style={{
              left: active.panel.left,
              top: active.panel.top,
              width: active.panel.width,
              height: active.panel.height,
              backgroundImage: `url(${src})`,
              backgroundSize: active.panel.backgroundSize,
              backgroundPosition: active.panel.backgroundPosition,
            }}
          />,
          document.body,
        )}
    </div>
  );
}
