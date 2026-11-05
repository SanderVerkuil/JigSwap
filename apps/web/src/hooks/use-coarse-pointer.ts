import * as React from "react";

// Whether the primary pointer is a finger (phones, tablets), not a mouse or
// trackpad. An iPad stays coarse with a keyboard attached.
const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

// Server (and hydration) snapshot: a fine pointer; the client's real value
// takes over right after hydration.
const getServerSnapshot = () => false;

export function useCoarsePointer() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
