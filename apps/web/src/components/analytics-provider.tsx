import {
  getPostHog,
  initPostHog,
  subscribePostHog,
} from "@/lib/analytics-client";
import { readAnalyticsConsent } from "@/lib/analytics-consent";
import type { PostHog } from "posthog-js";
import * as React from "react";

export { initPostHog };

// The web app inits PostHog in instrumentation-client.ts; Start has no such hook,
// so we init lazily on the client inside the provider (same config as web).
//
// CONSENT-GATED (the privacy policy promises this): PostHog only loads and
// initializes after the visitor accepts the cookie notice. On load we init only
// when the consent cookie says "granted"; when consent is granted mid-session
// the banner's accept callback calls initPostHog() directly (no reload needed).
// A declined or undecided notice means posthog-js is never downloaded (it is
// only reachable through the dynamic import in @/lib/analytics-client).
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // useState initializer runs once on the client; SSR skips it (no window).
  React.useState(() => {
    if (typeof window === "undefined") return;
    if (readAnalyticsConsent(document.cookie) === "granted") void initPostHog();
  });

  return children;
}

// The loaded PostHog client, or null until consent is granted and the library
// has loaded (always null during SSR, or when the import was blocked).
export function usePostHog(): PostHog | null {
  return React.useSyncExternalStore(subscribePostHog, getPostHog, () => null);
}

// Local replacement for posthog-js/react's useFeatureFlagEnabled: undefined
// until PostHog is loaded and its flags arrive.
export function useFeatureFlagEnabled(flag: string): boolean | undefined {
  const posthog = usePostHog();
  const subscribe = React.useCallback(
    (onChange: () => void) =>
      posthog ? posthog.onFeatureFlags(() => onChange()) : () => {},
    [posthog],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => posthog?.isFeatureEnabled(flag),
    () => undefined,
  );
}
