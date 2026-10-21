"use client";

import { usePinchZoom } from "@/components/common/use-pinch-zoom";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Hover zoom for an image, in two flavours (`mode`):
//   - "panel" (default): e-commerce "product zoom" — a lens marks the region under the cursor and a
//     floating result panel, portalled to <body> so it escapes any `overflow-hidden` ancestor,
//     renders that region magnified beside the image. Good for a small cover next to other content.
//   - "lens": an in-place magnifying glass — a circle follows the cursor over the image and shows
//     that spot magnified under it, with no separate panel. Good when the image is already large
//     (e.g. a lightbox) and a side panel would just get in the way.
// The hover zoom is pointer-only. On touch the image instead pinch-zooms and pans inside its own box
// (double-tap toggles 2x), so a pinch never zooms the whole page; at 1x a one-finger drag still
// scrolls the page. The image must sit centred in the wrapper (as `fill` does).
//
// object-contain aware: geometry is computed from the image's *rendered* (letterboxed) rect, so it
// works both for a `fill` cover in a square box and for an intrinsically-sized image in a lightbox.

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

type Painted = { backgroundSize: string; backgroundPosition: string };

type Active =
  | {
      mode: "panel";
      // Region marker over the image, in px relative to the wrapper.
      lens: { left: number; top: number; width: number; height: number };
      // Result panel, position:fixed in viewport px.
      panel: { left: number; top: number; size: number } & Painted;
    }
  | {
      mode: "lens";
      // Magnifier circle, in px relative to the wrapper.
      glass: { left: number; top: number; size: number } & Painted;
    };

export function ImageZoom({
  src,
  alt,
  mode = "panel",
  zoom = 2.5,
  panelSize = 360,
  lensSize = 200,
  fill = false,
  disabled = false,
  pinchZoom = true,
  className,
  wrapperClassName,
}: {
  src: string;
  alt: string;
  /** "panel" = side result panel; "lens" = in-place magnifying glass. */
  mode?: "panel" | "lens";
  /** Magnification relative to the displayed image. */
  zoom?: number;
  /** Result-panel edge length in px (panel mode). */
  panelSize?: number;
  /** Magnifier diameter in px (lens mode). */
  lensSize?: number;
  /** Fill a positioned parent (absolute inset-0) — for cover images in an aspect box. */
  fill?: boolean;
  /** Turn the hover zoom off (e.g. while the image is already zoomed by other means). */
  disabled?: boolean;
  /** Touch pinch-zoom/pan inside the wrapper. Off when a parent already handles it (PhotoZoom). */
  pinchZoom?: boolean;
  /** Extra classes on the <img>. */
  className?: string;
  /** Extra classes on the wrapper. */
  wrapperClassName?: string;
}) {
  const {
    surfaceRef: wrapperRef,
    zoom: touchZoom,
    zoomed,
    gesturing,
    handlers,
  } = usePinchZoom();
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
  const hoverZoom = finePointer && !disabled && !zoomed;

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

    // The magnified backdrop: the whole rendered image scaled by `zoom`.
    const bgW = renderedW * zoom;
    const bgH = renderedH * zoom;
    const wrapRect = wrapper.getBoundingClientRect();

    if (mode === "lens") {
      // Magnifying glass: a circle centred on the cursor, its content clamped so the glass is always
      // full of image (near an edge the magnification "sticks" rather than showing empty space).
      const posX = clamp(lensSize / 2 - fx * bgW, lensSize - bgW, 0);
      const posY = clamp(lensSize / 2 - fy * bgH, lensSize - bgH, 0);
      setActive({
        mode: "lens",
        glass: {
          left: e.clientX - wrapRect.left - lensSize / 2,
          top: e.clientY - wrapRect.top - lensSize / 2,
          size: lensSize,
          backgroundSize: `${bgW}px ${bgH}px`,
          backgroundPosition: `${posX}px ${posY}px`,
        },
      });
      return;
    }

    // Panel mode: a region marker over the image + a fixed result panel beside it.
    const lensW = Math.min(panelSize / zoom, renderedW);
    const lensH = Math.min(panelSize / zoom, renderedH);
    const lensCx = clamp(px, lensW / 2, renderedW - lensW / 2);
    const lensCy = clamp(py, lensH / 2, renderedH - lensH / 2);
    const lensLeft = box.left + offsetX + lensCx - lensW / 2 - wrapRect.left;
    const lensTop = box.top + offsetY + lensCy - lensH / 2 - wrapRect.top;

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
      mode: "panel",
      lens: { left: lensLeft, top: lensTop, width: lensW, height: lensH },
      panel: {
        left: panelLeft,
        top: panelTop,
        size: panelSize,
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${posX}px ${posY}px`,
      },
    });
  };

  const cursorClass =
    mode === "lens" ? "cursor-none" : finePointer && "cursor-zoom-in";

  return (
    <div
      ref={wrapperRef}
      className={cn(
        fill ? "absolute inset-0" : "relative",
        // Zoomed: every touch is ours (pan). At 1x the browser may pan the page but never pinch it.
        pinchZoom &&
          cn(
            "overflow-hidden select-none",
            zoomed ? "touch-none" : "touch-pan-x touch-pan-y",
          ),
        wrapperClassName,
      )}
      {...(pinchZoom ? handlers : {})}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        decoding="async"
        className={cn(
          fill && "h-full w-full object-contain",
          hoverZoom && cursorClass,
          // Animate double-tap changes, never live gestures; reduced motion → no animation.
          pinchZoom &&
            !gesturing &&
            "motion-safe:transition-transform motion-safe:duration-200",
          className,
        )}
        style={
          pinchZoom && zoomed
            ? {
                transform: `translate(${touchZoom.x}px, ${touchZoom.y}px) scale(${touchZoom.scale})`,
              }
            : undefined
        }
        onMouseMove={hoverZoom ? onMove : undefined}
        onMouseLeave={clear}
      />

      {/* Panel mode: region marker over the image. */}
      {active?.mode === "panel" && (
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

      {/* Panel mode: floating result panel, portalled past clipping ancestors. */}
      {active?.mode === "panel" &&
        createPortal(
          <div
            aria-hidden
            className="border-border pointer-events-none fixed z-[100] overflow-hidden rounded-xl border bg-white bg-no-repeat shadow-2xl dark:bg-neutral-900"
            style={{
              left: active.panel.left,
              top: active.panel.top,
              width: active.panel.size,
              height: active.panel.size,
              backgroundImage: `url(${src})`,
              backgroundSize: active.panel.backgroundSize,
              backgroundPosition: active.panel.backgroundPosition,
            }}
          />,
          document.body,
        )}

      {/* Lens mode: in-place magnifying glass following the cursor. */}
      {active?.mode === "lens" && (
        <span
          aria-hidden
          className="border-border/80 pointer-events-none absolute rounded-full border-2 bg-no-repeat shadow-xl ring-1 ring-black/20"
          style={{
            left: active.glass.left,
            top: active.glass.top,
            width: active.glass.size,
            height: active.glass.size,
            backgroundImage: `url(${src})`,
            backgroundSize: active.glass.backgroundSize,
            backgroundPosition: active.glass.backgroundPosition,
          }}
        />
      )}
    </div>
  );
}
