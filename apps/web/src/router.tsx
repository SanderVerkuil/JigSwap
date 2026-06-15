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
