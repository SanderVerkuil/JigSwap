import { useThree } from "@react-three/fiber";
import * as React from "react";

// The plank scenes render with frameloop="demand": a frame is drawn only when
// something asks for one. Damping useFrames ask for the next frame for as long
// as maath reports them unsettled; this module covers the outside triggers.

// After an idle stretch the first frame's delta is the whole pause; capping it
// keeps damped values from jumping straight to their target on that frame.
const MAX_FRAME_DELTA = 1 / 30;

export function frameDelta(delta: number): number {
  return Math.min(delta, MAX_FRAME_DELTA);
}

/**
 * Requests frames for a demand canvas: on mouse and pen moves over the event
 * source (the parallax follows the pointer; touch has none), when the theme
 * flips, and when the canvas scrolls back into view (changes made while it
 * was paused with frameloop="never" were not drawn).
 */
export function DemandFrames({
  eventSource,
  pointer,
  visible,
  theme,
}: {
  eventSource: React.RefObject<HTMLElement | null>;
  pointer: boolean;
  visible: boolean;
  theme: "light" | "dark";
}) {
  const invalidate = useThree((s) => s.invalidate);

  React.useEffect(() => {
    const el = eventSource.current;
    if (!pointer || !el) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") invalidate();
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, [eventSource, pointer, invalidate]);

  React.useEffect(() => {
    if (visible) invalidate();
  }, [visible, theme, invalidate]);

  return null;
}
