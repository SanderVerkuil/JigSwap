"use client";

import { ImageZoom } from "@/components/common/image-zoom";
import { cn } from "@/lib/utils";
import {
  clampPan,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  stepZoom,
  toggleDoubleTap,
  zoomAtPoint,
  type Point,
  type Size,
  type ZoomState,
} from "@/lib/zoom-math";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";

const TAP_SLOP = 10; // px a tap may wander before it counts as a drag
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30; // px between the two taps of a double-tap
const SWIPE_MIN = 50; // px of horizontal travel for a swipe

type Gesture =
  | {
      kind: "pan";
      start: Point;
      base: ZoomState;
      moved: boolean;
      /** The leftover finger of a pinch: never a tap or a swipe. */
      afterPinch: boolean;
    }
  | { kind: "pinch"; distance: number; mid: Point; base: ZoomState };

// The lightbox's image surface: touch pinch-zoom (1x–4x, anchored at the pinch midpoint), drag to
// pan while zoomed, double-tap to toggle 2x, and a horizontal swipe at 1x to change photo. Zoom
// buttons make the same zoom reachable by keyboard / screen reader / mouse. The mouse hover lens
// (ImageZoom) is untouched at 1x and switched off while zoomed. Mount with `key={photo}` so the
// zoom resets when the photo changes; it also resets on close because the dialog unmounts it.
export function PhotoZoom({
  src,
  alt,
  onSwipe,
}: {
  src: string;
  alt: string;
  /** Swipe at 1x: +1 = next photo (swiped left), -1 = previous. */
  onSwipe?: (direction: 1 | -1) => void;
}) {
  const t = useTranslations("copyInstance.photoLightbox");
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY);
  const [gesturing, setGesturing] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  const zoomed = zoom.scale > MIN_SCALE;

  // Viewport = the surface; content = the <img>'s layout box (its fitted 1x size — offset sizes
  // ignore our transform).
  const measure = (): { viewport: Size; content: Size } | null => {
    const surface = surfaceRef.current;
    const img = surface?.querySelector("img");
    if (!surface || !img) return null;
    return {
      viewport: { width: surface.clientWidth, height: surface.clientHeight },
      content: { width: img.offsetWidth, height: img.offsetHeight },
    };
  };

  // Client coordinates → px relative to the surface centre (the zoom-math frame).
  const toLocal = (clientX: number, clientY: number): Point => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return {
      x: clientX - r.left - r.width / 2,
      y: clientY - r.top - r.height / 2,
    };
  };

  const startGesture = (current: ZoomState) => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = {
        kind: "pinch",
        distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        base: current,
      };
    } else if (pts.length === 1) {
      gesture.current = {
        kind: "pan",
        start: pts[0],
        base: current,
        moved: false,
        afterPinch: false,
      };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Mouse at 1x belongs to the hover lens; mouse drag only pans once zoomed.
    if (e.pointerType === "mouse" && (!zoomed || e.button !== 0)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, toLocal(e.clientX, e.clientY));
    // A second finger makes this a pinch, so it can't be part of a double-tap.
    if (pointers.current.size > 1) lastTap.current = null;
    startGesture(zoom);
    setGesturing(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, toLocal(e.clientX, e.clientY));
    const g = gesture.current;
    const m = measure();
    if (!g || !m) return;

    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!b) return;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setZoom(
        clampPan(
          zoomAtPoint(
            g.base,
            (g.base.scale * distance) / g.distance,
            g.mid,
            mid,
          ),
          m.content,
          m.viewport,
        ),
      );
      return;
    }

    const p = pointers.current.get(e.pointerId)!;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
    if (g.base.scale > MIN_SCALE) {
      setZoom(
        clampPan(
          { scale: g.base.scale, x: g.base.x + dx, y: g.base.y + dy },
          m.content,
          m.viewport,
        ),
      );
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const end = pointers.current.get(e.pointerId)!;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;

    if (pointers.current.size > 0) {
      // Pinch → one finger left: continue as a pan from where the pinch left off.
      startGesture(zoom);
      if (gesture.current?.kind === "pan") gesture.current.afterPinch = true;
      return;
    }
    gesture.current = null;
    setGesturing(false);
    if (e.type === "pointercancel" || g?.kind !== "pan" || g.afterPinch) {
      return;
    }

    const dx = end.x - g.start.x;
    const dy = end.y - g.start.y;

    // Swipe between photos only at fit; when zoomed the drag was a pan.
    if (
      g.base.scale === MIN_SCALE &&
      onSwipe &&
      Math.abs(dx) > SWIPE_MIN &&
      Math.abs(dx) > Math.abs(dy) * 1.5
    ) {
      lastTap.current = null;
      onSwipe(dx < 0 ? 1 : -1);
      return;
    }

    // Double-tap (touch/pen): toggle 2x at the tap point / back to fit.
    if (e.pointerType === "mouse" || g.moved) return;
    const now = Date.now();
    const prev = lastTap.current;
    if (
      prev &&
      now - prev.at < DOUBLE_TAP_MS &&
      Math.hypot(end.x - prev.point.x, end.y - prev.point.y) < DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null;
      const m = measure();
      if (m) setZoom(toggleDoubleTap(zoom, end, m.content, m.viewport));
    } else {
      lastTap.current = { at: now, point: end };
    }
  };

  const step = (delta: number) => {
    const m = measure();
    if (m) setZoom(stepZoom(zoom, delta, m.content, m.viewport));
  };

  const controlClass =
    "inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="absolute inset-0">
      <div
        ref={surfaceRef}
        data-testid="photo-zoom-surface"
        // touch-action: none only here, so the browser hands pinch/pan to us on the photo while
        // the rest of the page keeps native touch behaviour.
        className={cn(
          "h-full w-full touch-none overflow-hidden select-none",
          zoomed && "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDragStart={(e) => e.preventDefault()}
      >
        <div
          data-testid="photo-zoom-content"
          className={cn(
            "h-full w-full will-change-transform",
            // Animate button/double-tap changes, never live gestures; reduced motion → no animation.
            !gesturing &&
              "motion-safe:transition-transform motion-safe:duration-200",
          )}
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          }}
        >
          <ImageZoom
            src={src}
            alt={alt}
            mode="lens"
            disabled={zoomed}
            className="max-h-full max-w-full object-contain"
            wrapperClassName="flex h-full w-full items-center justify-center"
          />
        </div>
      </div>

      <div className="absolute top-3 left-3 flex gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={zoom.scale <= MIN_SCALE}
          aria-label={t("zoomOut")}
          className={controlClass}
        >
          <Minus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={zoom.scale >= MAX_SCALE}
          aria-label={t("zoomIn")}
          className={controlClass}
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(IDENTITY)}
          disabled={!zoomed}
          aria-label={t("resetZoom")}
          className={controlClass}
        >
          <RotateCcw className="h-5 w-5" />
        </button>
      </div>
      {/* Announce the zoom level once it settles (not on every pinch frame). */}
      <span className="sr-only" aria-live="polite">
        {!gesturing &&
          t("zoomLevel", { percent: Math.round(zoom.scale * 100) })}
      </span>
    </div>
  );
}
