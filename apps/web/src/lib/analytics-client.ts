import type { PostHog } from "posthog-js";

// Lazy, consent-gated PostHog loader. posthog-js is NEVER statically imported
// anywhere in the app graph: it is fetched with a dynamic import() only once
// VITE_POSTHOG_KEY is set AND the visitor has accepted the cookie notice. This
// keeps the privacy policy's promise ("if you decline, it is never loaded")
// and means a content blocker that blocks the PostHog chunk can't take the
// whole client entry down with it — a failed import just leaves analytics off.

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
const listeners = new Set<() => void>();

// Called when consent is granted (the cookie banner's accept callback, or on
// load when the consent cookie already says "granted"). Idempotent: the module
// is imported and initialised at most once.
export function initPostHog(): Promise<PostHog | null> {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  loading ??= import("posthog-js").then(
    ({ default: posthog }) => {
      posthog.init(key, {
        api_host: "/ingest",
        ui_host: "https://eu.posthog.com",
        defaults: "2025-05-24",
        capture_exceptions: true,
        debug: import.meta.env.DEV,
      });
      client = posthog;
      for (const listener of listeners) listener();
      return posthog;
    },
    (error: unknown) => {
      // Blocked by a content blocker or a network failure: degrade silently.
      if (import.meta.env.DEV) {
        console.debug("[posthog] failed to load, analytics disabled", error);
      }
      return null;
    },
  );
  return loading;
}

export function getPostHog(): PostHog | null {
  return client;
}

export function subscribePostHog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
