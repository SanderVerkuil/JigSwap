import type { ConvexReactClient } from "convex/react";

// How long the hold below lasts if nothing takes over from it. Only a failure gets here: the provider
// takes over in hydration's first commit.
export const CONVEX_HOLD_MAX_MS = 15_000;

/**
 * Hold the Convex socket from the moment a signed-in document starts hydrating until
 * ConvexProviderWithClerk takes over with the real token (its first effect replaces this config).
 *
 * Hydrating a server-loaded query subscribes it at once. Sent before the token, a member read would
 * run as nobody and its answer (null, empty or an error) would replace the server's data on screen
 * until the token arrived. setAuth pauses the socket while a token is being fetched, and this fetch
 * finds none, slowly, so the socket can't stay paused for good.
 */
export function holdConvexUntilAuth(
  convex: Pick<ConvexReactClient, "setAuth">,
): void {
  convex.setAuth(({ forceRefreshToken }) =>
    // Convex asks a second time, forcing a refresh, when the first ask finds no token.
    forceRefreshToken
      ? Promise.resolve(null)
      : new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), CONVEX_HOLD_MAX_MS);
        }),
  );
}
