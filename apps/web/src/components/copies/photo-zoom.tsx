"use client";

import { ImageZoom } from "@/components/common/image-zoom";
import { usePinchZoom } from "@/components/common/use-pinch-zoom";
import { cn } from "@/lib/utils";
import { MAX_SCALE, MIN_SCALE } from "@/lib/zoom-math";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "use-intl";

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
  const { surfaceRef, zoom, zoomed, gesturing, step, reset, handlers } =
    usePinchZoom({ onSwipe });

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
        {...handlers}
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
            pinchZoom={false}
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
          onClick={reset}
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
