import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import * as React from "react";

// The web app inits PostHog in instrumentation-client.ts; Start has no such hook,
// so we init lazily on the client inside the provider (same config as web).
function initPostHog() {
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
    if (typeof window !== "undefined") initPostHog();
  });

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
