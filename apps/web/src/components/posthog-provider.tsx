import { readAnalyticsConsent } from "@/lib/analytics-consent";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import * as React from "react";

// The web app inits PostHog in instrumentation-client.ts; Start has no such hook,
// so we init lazily on the client inside the provider (same config as web).
//
// CONSENT-GATED (the privacy policy promises this): PostHog only initializes
// after the visitor accepts the cookie notice. On load we init only when the
// consent cookie says "granted"; when consent is granted mid-session the
// banner's accept callback calls initPostHog() directly (no reload needed).
// A declined or undecided notice means PostHog is never loaded.
export function initPostHog() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || posthog.__loaded) return;
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2025-05-24",
    capture_exceptions: true,
    debug: import.meta.env.DEV,
  });
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // useState initializer runs once on the client; SSR skips it (no window).
  React.useState(() => {
    if (typeof window === "undefined") return;
    if (readAnalyticsConsent(document.cookie) === "granted") initPostHog();
  });

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
