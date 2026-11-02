import {
  getPostHog,
  initPostHog,
  withdrawAnalyticsConsent as stopPostHog,
} from "./analytics-client";

// Single source of truth for analytics consent: the cookie, the choice the
// cookie banner records, and the PostHog opt-in state that follows it.
// Analytics must never start before the visitor allows it, must never start at
// all after a decline (see the privacy policy's analytics section, which
// promises exactly this), and a visitor can change their mind at any time
// ("Cookie settings" reopens the banner; GDPR Art. 7(3)).

export const ANALYTICS_CONSENT_COOKIE = "cookieConsent";

export type AnalyticsConsent = "granted" | "denied" | "unset";

// Pure parser (unit-tested): reads the consent decision out of a
// `document.cookie`-style string. Anything other than an explicit true/false
// value — missing cookie, malformed value — is "unset", which means the banner
// shows and analytics stays off.
export function readAnalyticsConsent(
  cookieString: string | null | undefined,
): AnalyticsConsent {
  if (!cookieString) return "unset";
  for (const part of cookieString.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name?.trim() !== ANALYTICS_CONSENT_COOKIE) continue;
    const value = rest.join("=").trim();
    if (value === "true") return "granted";
    if (value === "false") return "denied";
  }
  return "unset";
}

// Persist the visitor's decision. Path=/ so a choice made on any page applies
// site-wide; ~10 years, mirroring the previous far-future expiry.
export function writeAnalyticsConsent(decision: "granted" | "denied") {
  const value = decision === "granted" ? "true" : "false";
  const maxAge = 60 * 60 * 24 * 365 * 10;
  document.cookie = `${ANALYTICS_CONSENT_COOKIE}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
}

// --- Consent store (client only) --------------------------------------------
// The cookie banner subscribes to this: it shows while the visitor hasn't
// chosen, reappears when someone opens "Cookie settings", and hides as soon as
// a choice is recorded.

export type CookieBannerState = "hidden" | "undecided" | "settings";

let settingsRequested = false;
// The choice made in this tab. The cookie normally carries it, but a browser
// that blocks cookies discards the write, and the visitor must still be able to
// answer the banner: their choice then holds until the page is reloaded.
let sessionDecision: "granted" | "denied" | null = null;
const consentListeners = new Set<() => void>();

function notifyConsentListeners() {
  for (const listener of consentListeners) listener();
}

export function subscribeConsent(listener: () => void): () => void {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
}

// The cookie as it reads *now* comes first, so a choice made in another tab
// counts here too; this tab's own choice only fills in when no cookie exists.
export function currentAnalyticsConsent(): AnalyticsConsent {
  const stored = readAnalyticsConsent(document.cookie);
  return stored === "unset" ? (sessionDecision ?? "unset") : stored;
}

export function getCookieBannerSnapshot(): CookieBannerState {
  if (settingsRequested) return "settings";
  return currentAnalyticsConsent() === "unset" ? "undecided" : "hidden";
}

// "Cookie settings" (footer, privacy policy): reopen the banner so the visitor
// can allow or withdraw analytics.
export function openCookieSettings(): void {
  settingsRequested = true;
  notifyConsentListeners();
}

// Leave a reopened banner without changing anything.
export function closeCookieSettings(): void {
  settingsRequested = false;
  notifyConsentListeners();
}

function recordDecision(decision: "granted" | "denied") {
  writeAnalyticsConsent(decision);
  sessionDecision = decision;
  settingsRequested = false;
  notifyConsentListeners();
}

// Start PostHog (initPostHog opts it back in after an earlier withdrawal), then
// hold it to the current choice, so one made while posthog-js was still
// downloading is the one that counts, also from another tab. A withdrawal in
// this tab has already stopped it by then.
async function loadAnalytics(): Promise<void> {
  const client = await initPostHog();
  if (
    client &&
    getPostHog() === client &&
    currentAnalyticsConsent() !== "granted"
  ) {
    await stopPostHog();
  }
}

// "Allow analytics": store the grant and start PostHog right away (no reload).
export async function grantAnalyticsConsent(): Promise<void> {
  recordDecision("granted");
  await loadAnalytics();
}

// "No thanks", also after an earlier grant: store the decline, close the banner
// and stop PostHog through analytics-client's one shutdown path (flags off,
// reset, opt-out, stored identifiers gone). When it never loaded it stays
// unloaded.
export function withdrawAnalyticsConsent(): void {
  recordDecision("denied");
  void stopPostHog();
}

// Page load: start PostHog only for a visitor who allowed it earlier.
export function startAnalyticsIfGranted(): void {
  if (readAnalyticsConsent(document.cookie) === "granted") void loadAnalytics();
}
