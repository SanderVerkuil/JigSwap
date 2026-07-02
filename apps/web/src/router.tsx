import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { DefaultCatchBoundary } from "./components/DefaultCatchBoundary";
import { NotFoundContent } from "./components/NotFound";
import { routeTree } from "./routeTree.gen";

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
    defaultErrorComponent: DefaultCatchBoundary,
    // Chrome-free: TanStack renders the matched layout chain and drops this into
    // the deepest outlet, so a 404 picks up whichever shell it's under (app /
    // admin / marketing). The root route's own notFoundComponent (marketing
    // NotFound) covers truly top-level unmatched paths where no shell applies.
    defaultNotFoundComponent: () => <NotFoundContent />,
    context: { queryClient, convexClient: convex, convexQueryClient },
    scrollRestoration: true,
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
