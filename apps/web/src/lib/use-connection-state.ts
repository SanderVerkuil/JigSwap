// sanctioned convex/react exception: useConvex for the socket's connection state (see tanstack-query migration spec)
import { useConvex, type ConvexReactClient } from "convex/react";
import { useCallback, useSyncExternalStore } from "react";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getOnline = () => navigator.onLine;
// The server can't know, and the first client render must match it.
const assumeConnected = () => true;

/** Whether the browser says it is online (navigator.onLine), following its online/offline events. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, assumeConnected);
}

/**
 * Whether this page can reach JigSwap right now: the browser is online and Convex's socket is
 * open. Before the socket has first connected it counts as connected, so a page that is still
 * loading never reads as offline; only a socket that drops afterwards, or the browser going
 * offline, does. A boolean snapshot, so callers re-render only when it flips, not on every request
 * the socket carries.
 */
export function useConnectionState(): { connected: boolean } {
  // Undefined outside a ConvexProvider (component tests): only the browser's own signal counts.
  const convex = useConvex() as ConvexReactClient | undefined;
  const online = useOnline();
  const subscribeSocket = useCallback(
    (onChange: () => void) =>
      convex ? convex.subscribeToConnectionState(onChange) : () => {},
    [convex],
  );
  const getSocket = useCallback(() => {
    if (!convex) return true;
    const state = convex.connectionState();
    return state.isWebSocketConnected || !state.hasEverConnected;
  }, [convex]);
  const socket = useSyncExternalStore(
    subscribeSocket,
    getSocket,
    assumeConnected,
  );
  return { connected: online && socket };
}
