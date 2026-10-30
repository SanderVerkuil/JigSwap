import type { CaptureResult, PostHog } from "posthog-js";
import {
  readAnalyticsConsent,
  writeAnalyticsConsent,
} from "./analytics-consent";
import { sanitizeAnalyticsEvent } from "./analytics-privacy";

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
// is imported and initialised at most once; granting again after a withdrawal
// opts the same client back in.
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
        // Opting out also deletes PostHog's cookie and localStorage entry.
        opt_out_persistence_by_default: true,
        // Runs on every event before it leaves the browser: drop it without
        // consent, then strip query strings from its URLs (SEC-59) and drop
        // clicks on the messaging screens (SEC-47).
        before_send: [requireAnalyticsConsent, sanitizeAnalyticsEvent],
      });
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
  return loading.then(activate);
}

// Consent is granted: hand out the client. After a withdrawal, in this page or
// stored by PostHog from an earlier one, opt it back in first (without an
// extra $opt_in event, so a renewed grant looks like a first one).
function activate(posthog: PostHog | null): PostHog | null {
  if (!posthog) return null;
  if (posthog.has_opted_out_capturing()) {
    posthog.set_config({ advanced_disable_flags: false });
    posthog.opt_in_capturing({ captureEventName: false });
  }
  if (client !== posthog) setClient(posthog);
  return posthog;
}

// Withdraws analytics consent (GDPR Art. 7(3)). Records the refusal, so
// PostHog is never loaded on later visits, then shuts down a PostHog running
// in this page and deletes what it stored on the device. Declining in the
// cookie banner goes through here too, so any control that reopens the banner
// doubles as the withdrawal.
export async function withdrawAnalyticsConsent(): Promise<void> {
  writeAnalyticsConsent("denied");
  const posthog = loading ? await loading : null;
  if (posthog) {
    // No more requests at all: reset() would otherwise fetch feature flags
    // for the fresh identity.
    posthog.set_config({ advanced_disable_flags: true });
    // reset() also clears PostHog's own consent state, so it has to come
    // first: the opt-out after it is what sticks. It drops the member's
    // identity and (`true`) the device id, so nothing still queued can be
    // linked to them.
    posthog.reset(true);
    posthog.opt_out_capturing();
  }
  if (client) setClient(null);
  clearPostHogStorage();
}

// Every event re-reads the consent cookie, so withdrawing in one tab also
// silences PostHog in the member's other open tabs.
function requireAnalyticsConsent(event: CaptureResult): CaptureResult | null {
  return readAnalyticsConsent(document.cookie) === "granted" ? event : null;
}

function setClient(next: PostHog | null) {
  client = next;
  for (const listener of listeners) listener();
}

// PostHog keeps its identity in `ph_*` cookies, localStorage and
// sessionStorage. Its opt-out marker (`__ph_opt_in_out_*`) is kept on purpose:
// it holds no identifier and keeps a reloaded PostHog opted out.
function clearPostHogStorage() {
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const keys = Array.from({ length: storage.length }, (_, i) =>
        storage.key(i),
      );
      for (const key of keys) {
        if (key?.startsWith("ph_")) storage.removeItem(key);
      }
    }
  } catch {
    // Storage disabled by the browser: nothing was stored there either.
  }
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name?.startsWith("ph_")) expireCookie(name);
  }
}

// PostHog sets its cookie on the page's host or, for cross-subdomain
// tracking, on a parent domain; expire it on each.
function expireCookie(name: string) {
  const expired = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  const labels = window.location.hostname.split(".");
  document.cookie = expired;
  for (let i = 0; i < labels.length - 1; i++) {
    document.cookie = `${expired}; domain=.${labels.slice(i).join(".")}`;
  }
}

export function getPostHog(): PostHog | null {
  return client;
}

export function subscribePostHog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
