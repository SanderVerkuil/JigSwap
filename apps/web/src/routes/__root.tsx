import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useLoaderData,
  useRouteContext,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import * as React from "react";
import { DefaultCatchBoundary } from "../components/DefaultCatchBoundary";
import { NotFound } from "../components/NotFound";
import { Providers } from "../components/providers";
import { ErrorBoundary } from "../components/ui/error-boundary";
import { getIntl } from "../lib/i18n";
// Tailwind 4 entry + theme tokens; CSS-based config travels with this import.
import appCss from "../styles/globals.css?url";

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
    links: [
      { rel: "stylesheet", href: appCss },
      // Fonts that next/font loaded in the web app, now via Google Fonts so
      // globals.css --font-sans (Poppins) / --font-heading (Baloo 2) resolve.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@400..800&family=Poppins:wght@100;200;300;400;500;600;700;800;900&display=swap",
      },
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
  // Resolve locale + messages on the server so IntlProvider has them at first paint.
  loader: async () => {
    return await getIntl();
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
  const { locale, messages } = useLoaderData({ from: Route.id });
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={context.convexClient} useAuth={useAuth}>
        <RootDocument>
          <Providers locale={locale} messages={messages}>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Providers>
        </RootDocument>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
