// Single source of truth for the analytics-consent cookie shared by the cookie
// banner (which writes it) and the PostHog provider (which gates init on it).
// Analytics must never start before the visitor accepts the cookie notice, and
// must never start at all after a decline (see the privacy policy's analytics
// section, which promises exactly this).

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
