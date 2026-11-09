import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouteContext,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import * as React from "react";
import { RouteAnnouncer } from "../components/a11y/route-announcer";
import { DefaultCatchBoundary } from "../components/DefaultCatchBoundary";
import { NotFound } from "../components/NotFound";
import { Providers } from "../components/providers";
import { ErrorBoundary } from "../components/ui/error-boundary";
import { useClerkLocalization } from "../lib/clerk-localization";
import { contextLocale, getIntlCached, seedIntlCache } from "../lib/i18n";
import {
  catalogPreloadLinks,
  loadCatalog,
  messagesFor,
} from "../lib/i18n-catalog";
import { defaultDocumentTitle } from "../lib/page-title";
import { preconnectLinks } from "../lib/preconnect";
import { ZOD_JITLESS_SCRIPT } from "../lib/zod-jitless";
// Side effect: start listening for beforeinstallprompt before any route chunk loads.
import "../lib/install-prompt";
// Self-hosted font files to preload (see head below).
import hankenLatinWoff2 from "@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2?url";
import youngSerifLatinWoff2 from "@fontsource/young-serif/files/young-serif-latin-400-normal.woff2?url";
// Tailwind 4 entry + theme tokens; CSS-based config travels with this import.
import appCss from "../styles/globals.css?url";

// The signed-in member's Clerk user id for route guards. Returns nothing else:
// its result reaches the browser, as this server fn's response and through the
// dehydrated beforeLoad context. SSR calls it in-process, the browser over HTTP
// once per page load (see clientAuthCache).
const fetchClerkUserId = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { userId } = await auth();
    return { userId };
  } catch {
    // During static prerender (and any context without a Clerk request) there
    // is no session, so `auth()` cannot resolve. Fall back to unauthenticated
    // so public routes like /docs can still be generated.
    return { userId: null };
  }
});

// beforeLoad re-runs on EVERY navigation (root always matches), which used to
// fire a fetchClerkUserId round-trip per click. On the client, Clerk's SDK owns
// live session state, so fetch once per page load and reuse across client-side
// navigations — sign-in/out flows end in a full-page redirect, which naturally
// resets this cache. The cache is seeded at hydration from the SSR-dehydrated
// beforeLoad context (see RootComponent), so the first client navigation is
// request-free too.
type AuthPayload = { userId: string | null };
let clientAuthCache: AuthPayload | null = null;

type RootHeadContext = {
  match: { context: unknown };
  matches: ReadonlyArray<{ _notFound?: boolean }>;
};

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
  convexQueryClient: ConvexQueryClient;
}>()({
  // The annotation matters: an unannotated parameter here makes TypeScript settle the route's
  // context before it has seen beforeLoad below, and every route loses userId and intl.
  head: ({ match, matches }: RootHeadContext) => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover lets the mobile shell extend under the notch /
      // home indicator and pad itself with env(safe-area-inset-*).
      // interactive-widget=resizes-content makes the on-screen keyboard shrink
      // the layout viewport (so `dvh`/the shell resize above it) instead of
      // overlaying and hiding the bottom bar / focused input.
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: defaultDocumentTitle(match.context, matches) },
      // Installed-app ("Add to Home Screen") chrome. theme-color lives in
      // RootDocument: HeadContent dedupes metas by name, which would drop the
      // light/dark pair down to one.
      { name: "application-name", content: "JigSwap" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "JigSwap" },
      // "default" keeps iOS's status bar opaque above the page, so the shell's
      // safe-area padding isn't doubled under a translucent bar.
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [
      // Favicon set generated from the JigSwap puzzle-piece mark (source:
      // components/common/header-icon/logo.png); served from apps/web/public.
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      {
        rel: "icon",
        type: "image/png",
        href: "/icon-512.png",
        sizes: "512x512",
      },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      // Makes the site installable (Android/Chromium "Install app"). No
      // service-worker caching is involved; /sw.js stays push-only.
      { rel: "manifest", href: "/manifest.webmanifest" },
      // Clerk and Convex gate every page's first useful paint (clerk-js, then the
      // session, then the Convex socket), so open those connections early.
      ...preconnectLinks({
        clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
          string | undefined,
        convexUrl: import.meta.env.VITE_CONVEX_URL as string | undefined,
      }),
      // Hydration waits for the page's message catalog (router.tsx), so fetch
      // it alongside the document instead of after the scripts have run.
      ...catalogPreloadLinks(contextLocale(match.context)),
      { rel: "stylesheet", href: appCss },
      // The fonts are self-hosted: globals.css imports their @font-face rules.
      // Preload the latin files of the faces every page shows (Young Serif
      // headings, Hanken Grotesk body text) so they load alongside the CSS
      // instead of after it. Same hashed URL as the CSS url(), so nothing
      // downloads twice; font preloads must be CORS-mode to be reused.
      {
        rel: "preload",
        href: youngSerifLatinWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: hankenLatinWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  // Resolves auth + intl into the root context. beforeLoad context is
  // dehydrated to the client by Start's SSR, and child head() functions can
  // read it for localized titles (loaderData is NOT reliably resolved by the
  // time a child head runs, so this must live in context, not a loader).
  beforeLoad: async () => {
    const isBrowser = typeof window !== "undefined";
    const [auth, intl] = await Promise.all([
      (isBrowser && clientAuthCache) || fetchClerkUserId(),
      // The catalog stays out of this context (it is dehydrated into every
      // document); it is loaded into lib/i18n-catalog before the context
      // exists, so messagesFor(intl.locale) is ready whenever the root renders.
      // A no-op after the first load of a locale in the browser.
      getIntlCached().then(async (payload) => {
        await loadCatalog(payload.locale);
        return payload;
      }),
    ]);
    if (isBrowser) {
      clientAuthCache = { userId: auth.userId };
    }
    // No Convex token here: asking Clerk for one is a network call most routes have no use for, and
    // this context is serialized into the HTML. A loader whose reads depend on the member asks for
    // it itself (lib/ssr-member-data.ts).
    return { userId: auth.userId, intl };
  },
  errorComponent: (props) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
});

// Make all Clerk UI (UserButton menu, UserProfile modal, sign-in/up) follow our
// design tokens. The values are var(--…) references to the same CSS variables
// the app themes with, so Clerk tracks both the brand palette and light/dark
// automatically — the browser resolves each var to the active theme's value, no
// theme detection needed. (Clerk ignores variables it doesn't recognise.)
const clerkAppearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorTextOnPrimaryBackground: "var(--primary-foreground)",
    colorText: "var(--popover-foreground)",
    colorTextSecondary: "var(--muted-foreground)",
    colorBackground: "var(--popover)",
    colorInputText: "var(--foreground)",
    colorInputBackground: "var(--background)",
    colorNeutral: "var(--foreground)",
    colorDanger: "var(--destructive)",
    colorSuccess: "var(--jigsaw-success)",
    colorWarning: "var(--jigsaw-warning)",
  },
  // Clerk's fields are 13px, and iOS zooms the page into any field under 16px on focus. On touch,
  // only the input text goes to 16px (not Clerk's global fontSize, which would scale every label).
  // Its fields and buttons are 30-36px: on touch they reach the app's 44px target.
  elements: {
    formFieldInput: {
      "@media (pointer: coarse)": { fontSize: "16px", minHeight: "44px" },
    },
    formButtonPrimary: { "@media (pointer: coarse)": { minHeight: "44px" } },
    socialButtonsIconButton: {
      "@media (pointer: coarse)": { minHeight: "44px" },
    },
    socialButtonsBlockButton: {
      "@media (pointer: coarse)": { minHeight: "44px" },
    },
    formFieldInputShowPasswordButton: {
      "@media (pointer: coarse)": { minHeight: "44px", minWidth: "44px" },
    },
    // Clerk draws the account menu's rows in the text colour at 62% alpha, under 4.5:1 on white
    // with Canal Ink. Muted text is opaque and passes in both themes. Our rows are custom items;
    // Manage account is Clerk's own action.
    userButtonPopoverCustomItemButton: { color: "var(--muted-foreground)" },
    userButtonPopoverCustomItemButtonIconBox: {
      color: "var(--muted-foreground)",
    },
    userButtonPopoverActionButton: { color: "var(--muted-foreground)" },
    userButtonPopoverActionButtonIcon: { color: "var(--muted-foreground)" },
  },
} as const;

function RootComponent() {
  const context = useRouteContext({ from: Route.id });
  const { intl, userId } = context;
  // This page's CSP nonce (router.tsx), for the scripts Clerk and next-themes add.
  const cspNonce = useRouter().options.ssr?.nonce;

  // Seed the client caches from the SSR-dehydrated context so the first
  // client-side navigation re-runs beforeLoad without any server round-trip.
  React.useEffect(() => {
    clientAuthCache ??= { userId };
    seedIntlCache(intl);
    // Seeding only — initial values are by definition the SSR ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render Clerk's own UI (UserButton, UserProfile, sign-in/up) in the active
  // app locale. Reactive to intl.locale so a language switch re-localizes Clerk;
  // the Dutch strings load on demand instead of riding in the entry chunk.
  const clerkLocalization = useClerkLocalization(intl.locale);
  return (
    <ClerkProvider
      localization={clerkLocalization}
      appearance={clerkAppearance}
      nonce={cspNonce}
    >
      <ConvexProviderWithClerk client={context.convexClient} useAuth={useAuth}>
        <AuthCacheSync />
        <RootDocument locale={intl.locale}>
          <Providers
            locale={intl.locale}
            messages={messagesFor(intl.locale) ?? {}}
            now={intl.now}
            cspNonce={cspNonce}
          >
            {/* Speaks each new page title and moves focus to its main content (UX-68). */}
            <RouteAnnouncer />
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

// `locale` is threaded from the resolved intl context so <html lang> matches the
// active language (nl/en) for screen readers, browser translation, hyphenation and
// SEO. The errorComponent path has no resolved intl context, so it falls back to "en".
function RootDocument({
  children,
  locale = "en",
}: {
  children: React.ReactNode;
  locale?: string;
}) {
  const cspNonce = useRouter().options.ssr?.nonce;
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Runs before every module: zod must parse without eval
            (lib/zod-jitless.ts). */}
        <script
          nonce={cspNonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: ZOD_JITLESS_SCRIPT }}
        />
        {/* Tints the browser / installed-app status bar to the mobile top
            bar's sky surface per OS colour scheme; the manifest carries the
            light value. */}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#e3f1fa"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#0f2a33"
        />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
