import { enUS, nlNL } from "@clerk/localizations";
import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import * as React from "react";
import { DefaultCatchBoundary } from "../components/DefaultCatchBoundary";
import { NotFound } from "../components/NotFound";
import { Providers } from "../components/providers";
import { ErrorBoundary } from "../components/ui/error-boundary";
import { getIntlCached, seedIntlCache } from "../lib/i18n";
// Tailwind 4 entry + theme tokens; CSS-based config travels with this import.
import appCss from "../styles/globals.css?url";

// Runs on the server during beforeLoad so the Convex HTTP client can be authed
// for SSR reads; uses the "convex" JWT template configured in Clerk.
const fetchClerkAuth = createServerFn({ method: "GET" }).handler(async () => {
  const { userId, getToken } = await auth();
  const token = await getToken({ template: "convex" });
  return { userId, token };
});

// beforeLoad re-runs on EVERY navigation (root always matches), which used to
// fire a fetchClerkAuth round-trip per click. The SSR token only matters for
// server loaders; on the client, Clerk's SDK owns live session state and
// ConvexProviderWithClerk refreshes tokens itself. So fetch once per page
// load and reuse across client-side navigations — sign-in/out flows end in a
// full-page redirect, which naturally resets this cache. The cache is seeded
// at hydration from the SSR-dehydrated beforeLoad context (see RootComponent),
// so the first client navigation is request-free too.
type AuthPayload = { userId: string | null; token: string | null };
let clientAuthCache: AuthPayload | null = null;

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
  convexQueryClient: ConvexQueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover lets the mobile shell extend under the notch /
      // home indicator and pad itself with env(safe-area-inset-*).
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "JigSwap" },
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
        // Baloo 2 is the single heading face for both the app (--font-heading)
        // and marketing (--font-mk-heading); Poppins is the body sans.
        href: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@400..800&family=Poppins:wght@100;200;300;400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  // Resolves auth + intl into the root context. beforeLoad context is
  // dehydrated to the client by Start's SSR, and child head() functions can
  // read it for localized titles (loaderData is NOT reliably resolved by the
  // time a child head runs, so this must live in context, not a loader).
  beforeLoad: async (ctx) => {
    const isBrowser = typeof window !== "undefined";
    const [auth, intl] = await Promise.all([
      (isBrowser && clientAuthCache) || fetchClerkAuth(),
      getIntlCached(),
    ]);
    if (isBrowser) {
      clientAuthCache = { userId: auth.userId, token: auth.token };
    }
    if (auth.token) {
      // Hand the Clerk token to the server HTTP client so SSR loaders see the auth.
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(auth.token);
    }
    return { userId: auth.userId, token: auth.token, intl };
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
  const { intl, userId, token } = context;

  // Seed the client caches from the SSR-dehydrated context so the first
  // client-side navigation re-runs beforeLoad without any server round-trip.
  React.useEffect(() => {
    clientAuthCache ??= { userId, token };
    seedIntlCache(intl);
    // Seeding only — initial values are by definition the SSR ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render Clerk's own UI (UserButton, UserProfile, sign-in/up) in the active
  // app locale. Reactive to intl.locale so a language switch re-localizes Clerk.
  return (
    <ClerkProvider localization={intl.locale === "nl" ? nlNL : enUS}>
      <ConvexProviderWithClerk client={context.convexClient} useAuth={useAuth}>
        <AuthCacheSync />
        <RootDocument>
          <Providers locale={intl.locale} messages={intl.messages}>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Providers>
        </RootDocument>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

// If Clerk's client-side session diverges from the cached beforeLoad auth
// (e.g. a sign-out that doesn't hard-reload), drop the cache and re-run the
// root beforeLoad so route guards see the new state.
function AuthCacheSync() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (isSignedIn === undefined || !clientAuthCache) return;
    if (isSignedIn !== !!clientAuthCache.userId) {
      clientAuthCache = null;
      void router.invalidate();
    }
  }, [isSignedIn, router]);
  return null;
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
