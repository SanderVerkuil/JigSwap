import CookieConsent from "@/components/blocks/cookie-consent";
import { PostHogPageView } from "@/components/posthog-page-view";
import { PostHogProvider } from "@/components/posthog-provider";
import { Toaster } from "@/components/ui/sonner";
import { type Messages, timeZone } from "@/lib/i18n";
import { ThemeProvider } from "next-themes";
import * as React from "react";
import { IntlProvider } from "use-intl";

// Ports apps/web/src/app/providers.tsx. Clerk + Convex stay in __root.tsx (they
// wrap this tree); next-intl is swapped for use-intl with locale/messages
// resolved in the root loader so SSR has them.
export function Providers({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Messages;
  children: React.ReactNode;
}) {
  return (
    <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <PostHogProvider>
          {children}
          <CookieConsent variant="mini" />
          <PostHogPageView />
          <Toaster />
        </PostHogProvider>
      </ThemeProvider>
    </IntlProvider>
  );
}
