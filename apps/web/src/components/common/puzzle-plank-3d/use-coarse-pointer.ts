import * as React from "react";

const COARSE_POINTER = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(COARSE_POINTER);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True when the primary pointer is coarse (a touch screen). The 3D shelf's
 * parallax follows a hovering pointer, which a finger never provides. False on
 * the server and during hydration.
 */
export function useCoarsePointer(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );
}
