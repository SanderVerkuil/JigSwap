import { PostHogPageView } from "@/components/analytics-page-view";
import { initPostHog, PostHogProvider } from "@/components/analytics-provider";
import { AppUpdatePrompt } from "@/components/app-update-prompt";
import CookieConsent from "@/components/blocks/cookie-consent";
import { Toaster } from "@/components/ui/sonner";
import { timeZone, type Messages } from "@/lib/i18n";
import { ThemeProvider } from "next-themes";
import * as React from "react";
import { IntlProvider } from "use-intl";

const noopSubscribe = () => () => {};

// Ports apps/web/src/app/providers.tsx. Clerk + Convex stay in __root.tsx (they
// wrap this tree); next-intl is swapped for use-intl with locale/messages
// resolved in the root loader so SSR has them.
export function Providers({
  locale,
  messages,
  now: serverNow,
  children,
}: {
  locale: string;
  messages: Messages;
  now: number;
  children: React.ReactNode;
}) {
  // Global `now` from the server render, so SSR and hydration agree on relative
  // times (and use-intl never falls back to the environment clock). Dropped
  // once hydrated: the intl payload is cached client-side, so this instant goes
  // stale in long sessions; useNow() in components mounted later then starts
  // from the live clock instead. Callers pass `now` explicitly via
  // useRelativeTime().
  const hydrated = React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const ssrNow = React.useMemo(() => new Date(serverNow), [serverNow]);
  const now = hydrated ? undefined : ssrNow;

  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
      now={now}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <PostHogProvider>
          {children}
          {/* Accepting the notice starts analytics right away (no reload);
              PostHogProvider only auto-inits when consent was already granted. */}
          <CookieConsent variant="mini" onAcceptCallback={initPostHog} />
          <PostHogPageView />
          <Toaster />
          <AppUpdatePrompt />
        </PostHogProvider>
      </ThemeProvider>
    </IntlProvider>
  );
}
