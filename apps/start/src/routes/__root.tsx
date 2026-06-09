import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import * as React from "react";
import { DefaultCatchBoundary } from "../components/DefaultCatchBoundary";
import { NotFound } from "../components/NotFound";

// Runs on the server during beforeLoad so the Convex HTTP client can be authed
// for SSR reads; uses the "convex" JWT template configured in Clerk.
const fetchClerkAuth = createServerFn({ method: "GET" }).handler(async () => {
  const { userId, getToken } = await auth();
  const token = await getToken({ template: "convex" });
  return { userId, token };
});

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
  convexQueryClient: ConvexQueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "JigSwap (Start)" },
    ],
  }),
  beforeLoad: async (ctx) => {
    const { userId, token } = await fetchClerkAuth();
    if (token) {
      // Hand the Clerk token to the server HTTP client so SSR loaders see the auth.
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    }
    return { userId, token };
  },
  errorComponent: (props) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
});

function RootComponent() {
  const context = useRouteContext({ from: Route.id });
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={context.convexClient} useAuth={useAuth}>
        <RootDocument>
          <Outlet />
        </RootDocument>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <nav style={{ display: "flex", gap: "1rem", padding: "0.75rem" }}>
          <Link to="/" activeOptions={{ exact: true }}>
            Home
          </Link>
          <Link to="/insights">Insights</Link>
        </nav>
        <hr />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
