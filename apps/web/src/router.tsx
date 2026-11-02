import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import {
  createIsomorphicFn,
  getGlobalStartContext,
} from "@tanstack/react-start";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { NotFoundContent } from "./components/NotFound";
import { RouteError } from "./components/route-error";
import { loadClerkLocalization } from "./lib/clerk-localization";
import {
  dehydrateIntl,
  hydrateIntl,
  type DehydratedIntl,
} from "./lib/i18n-catalog";
import { appScrollRestoration } from "./lib/scroll-restoration";
import { holdConvexUntilAuth } from "./lib/ssr-member-data";
import { routeTree } from "./routeTree.gen";

// This page render's CSP nonce, set by cspMiddleware (lib/csp.ts); undefined in dev and
// prerender. As `ssr.nonce` the router stamps it on every script and preload it writes and
// renders it in a csp-nonce meta tag, from which the browser-side router reads it back on
// hydration. No request context exists when the router is built to resolve a server
// function's redirect, which renders nothing.
const getCspNonce = createIsomorphicFn()
  .server(() => {
    try {
      return getGlobalStartContext()?.cspNonce;
    } catch {
      return undefined;
    }
  })
  .client(() => undefined);

type DehydratedRouter = DehydratedIntl & { signedIn?: boolean };

export function getRouter() {
  const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;
  if (!CONVEX_URL) {
    throw new Error("missing VITE_CONVEX_URL envar");
  }

  // unsavedChangesWarning is meaningless on the server; disabled to avoid SSR warnings.
  const convex = new ConvexReactClient(CONVEX_URL, {
    unsavedChangesWarning: false,
  });
  const convexQueryClient = new ConvexQueryClient(convex);

  // Route Convex reads through TanStack Query so SSR + live updates share one cache.
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        // WHY Infinity: the bridge holds a live Convex subscription per cached query and
        // pushes every new server result straight into this cache, so data is never
        // stale and never needs refetch-on-mount/focus. The @convex-dev/react-query
        // README: "New query results are pushed from the server, so a staleTime of
        // Infinity should be used." (convexQuery() also sets it per-site; this default
        // covers anything routed through the global queryFn without the factory.)
        staleTime: Infinity,
        // gcTime deliberately stays at the TanStack default (5 min): the README
        // prescribes no value, only that it controls how long the Convex subscription
        // outlives the last unmounted useQuery — 5 min keeps remounts (tab switches,
        // navigation) rendering instantly from live cache instead of flashing loading.
      },
    },
  });
  convexQueryClient.connect(queryClient);

  const router = createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    // Route errors render inside Providers, so they get the translated card; the root route's
    // own errorComponent (outside IntlProvider) keeps the hook-free DefaultCatchBoundary.
    defaultErrorComponent: RouteError,
    // Chrome-free: TanStack renders the matched layout chain and drops this into
    // the deepest outlet, so a 404 picks up whichever shell it's under (app /
    // admin / marketing). The root route's own notFoundComponent (marketing
    // NotFound) covers truly top-level unmatched paths where no shell applies.
    defaultNotFoundComponent: () => <NotFoundContent />,
    context: { queryClient, convexClient: convex, convexQueryClient },
    ssr: { nonce: getCspNonce() },
    // The server hands the browser just the locale, never the catalog (a
    // cached asset, see lib/i18n-catalog.ts). The router awaits hydrate()
    // before it hydrates the matches, so the locale's catalog (preloaded by the
    // root head) is in messagesFor() for the first client render; hydrateIntl
    // never rejects, so a catalog that cannot load leaves a usable page rather
    // than a dead one. Clerk's strings for the locale start loading too, but
    // hydration does not wait for them (Clerk renders nothing localized during
    // SSR). setupRouterSsrQueryIntegration below chains onto both hooks.
    dehydrate: (): DehydratedRouter => {
      const root = router.state.matches[0]?.context;
      return { ...dehydrateIntl(root), signedIn: Boolean(root?.userId) };
    },
    hydrate: async (state: DehydratedRouter) => {
      // Before the query integration below hydrates (and so subscribes to) any member data.
      if (state.signedIn) holdConvexUntilAuth(convex);
      if (state.locale) void loadClerkLocalization(state.locale);
      await hydrateIntl(state);
    },
    ...appScrollRestoration,
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>
        {children}
      </ConvexProvider>
    ),
  });
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
