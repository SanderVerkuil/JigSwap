import { auth } from "@clerk/tanstack-react-start/server";
import type { QueryClient } from "@tanstack/react-query";
import { createServerOnlyFn } from "@tanstack/react-start";
import type { ConvexReactClient } from "convex/react";

// Server-side rendering of a signed-in member's own data, so a page's first paint doesn't wait for
// clerk-js, a token, the Convex socket and then the page's reads.
//
// That data ends up in the page's HTML, which is safe only because every signed-in page goes out as
// `private, no-store` (lib/response-cache.ts) and from next to Convex (the region pin in
// vite.config.ts). The token itself never reaches the HTML (getSsrConvexToken below).
//
// What a hard load costs: each prefetched read runs twice, once over HTTP here and once on the socket
// when hydration subscribes it. Client-side navigation pays only the subscription.

// The longest a page's first byte waits for its member data. A read still running then is called off
// and the page renders its usual skeleton for it; the browser reads it itself. A slow backend must
// not cost what SSR's shell already gives.
export const SSR_MEMBER_DATA_BUDGET_MS = 400;

// Server only: the Convex JWT ("convex" template in Clerk) that authenticates a loader's reads. With a
// template this is a call to Clerk's API, so only a route whose server reads depend on the member asks,
// and the budget above holds it. Never returned from a server fn or put in the route context, which is
// dehydrated into the page HTML; in the browser, ConvexProviderWithClerk fetches its own token from
// Clerk.
const getSsrConvexToken = createServerOnlyFn(async () => {
  try {
    const { userId, getToken } = await auth();
    return userId ? await getToken({ template: "convex" }) : null;
  } catch {
    return null;
  }
});

type ServerReadContext = {
  userId?: string | null;
  convexQueryClient: { serverHttpClient?: { setAuth(token: string): void } };
};

/**
 * For a route that reads on the server for everyone, and whose answers depend on who asks. Whether
 * those reads can run as the viewer: a signed-in viewer's token is handed to the server's client,
 * unless Clerk has none or doesn't answer within the budget. Then read nothing and leave the page to
 * the browser, as reading as nobody could tell a member that a page they may open doesn't exist.
 */
export async function authorizeServerReads(
  context: ServerReadContext,
): Promise<boolean> {
  if (typeof window !== "undefined" || !context.userId) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const token = await Promise.race([
    getSsrConvexToken(),
    new Promise<null>((resolve) => {
      timer = setTimeout(resolve, SSR_MEMBER_DATA_BUDGET_MS, null);
    }),
  ]);
  clearTimeout(timer);
  if (token) context.convexQueryClient.serverHttpClient?.setAuth(token);
  return Boolean(token);
}

/**
 * Runs a route's prefetch during SSR for a request that really has a member and a token. In the
 * browser it does nothing, so a client-side navigation never waits on it (the page's reads are
 * subscriptions there, and usually cached already).
 *
 * The token and `loadPrefetch` both count against the budget (a slow Clerk or a cold server can spend
 * it all, and then no read starts). `loadPrefetch` is a dynamic import, so the prefetch stays out of
 * the browser's bundles.
 *
 * At the budget, every read still running is called off, and with it any read it would have led to.
 * Left to land, it would reach the query cache after the page's data was already sent, and go down
 * the query stream to the browser, which hydrates that into its cache without waiting for React. The
 * server may have painted that section's skeleton while the first client render finds data: a
 * hydration mismatch. These routes read nothing else on the server, so calling off every read is safe.
 */
export async function loadMemberDataOnServer(
  context: ServerReadContext & { queryClient: QueryClient },
  loadPrefetch: () => Promise<(queryClient: QueryClient) => Promise<unknown>>,
): Promise<void> {
  if (typeof window !== "undefined") return;
  if (!context.userId) return;
  let overBudget = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([getSsrConvexToken(), loadPrefetch()])
      .then(([token, prefetch]) => {
        // No token: the reads would run as nobody and put that in the page.
        if (overBudget || !token) return;
        context.convexQueryClient.serverHttpClient?.setAuth(token);
        return prefetch(context.queryClient);
      })
      .catch(() => undefined),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        overBudget = true;
        resolve(undefined);
      }, SSR_MEMBER_DATA_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
  if (overBudget) await context.queryClient.cancelQueries();
}

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
