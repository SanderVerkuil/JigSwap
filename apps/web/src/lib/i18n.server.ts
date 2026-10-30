import { match } from "@formatjs/intl-localematcher";
import {
  getCookie,
  getRequestHeader,
  setCookie,
} from "@tanstack/react-start/server";
import Negotiator from "negotiator";
import {
  defaultLocale,
  INTL_COOKIE_NAME,
  isLocale,
  locales,
  mergeMessages,
  type Locale,
  type Messages,
} from "./i18n";

// Server-only half of lib/i18n.ts: locale negotiation, the locale cookie and catalog loading.
// Only the server-function handlers in i18n.ts call into this file, so the Start compiler drops
// the import (and Negotiator, the locale matcher and the request primitives with it) from the
// client bundle; the *.server.ts name makes import protection fail the build if a client module
// ever imports it directly.

// A tag is safe to hand to match() only if Intl can canonicalize it. Negotiator
// emits the wildcard "*" (meaning "any language") and passes through malformed
// tags, both of which make Intl.getCanonicalLocales — and therefore match() —
// throw RangeError("Incorrect locale information provided"). One bad tag throws
// the whole list, so we filter per-tag before negotiating.
function isCanonicalizableTag(tag: string): boolean {
  if (tag === "*") return false;
  try {
    Intl.getCanonicalLocales(tag);
    return true;
  } catch {
    return false;
  }
}

// Pure (no server primitives) so it's unit-testable: pick the best supported
// locale from an Accept-Language header, or null if none negotiate.
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
): Locale | null {
  if (!acceptLanguage) return null;
  const requested = new Negotiator({
    headers: { "accept-language": acceptLanguage },
  })
    .languages()
    .filter(isCanonicalizableTag);
  if (requested.length === 0) return null;
  const matched = match(requested, locales as readonly string[], defaultLocale);
  return isLocale(matched) ? matched : null;
}

// Resolve the active locale from the jigswap-intl cookie, falling back to
// Accept-Language negotiation, then the default.
export function detectLocale(): Locale {
  const cookie = getCookie(INTL_COOKIE_NAME);
  if (isLocale(cookie)) return cookie;
  return negotiateLocale(getRequestHeader("accept-language")) ?? defaultLocale;
}

// Persists the chosen locale for a year.
export function writeLocaleCookie(locale: Locale): void {
  setCookie(INTL_COOKIE_NAME, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

// Dev shows the locale's catalog over source.json, so translated keys appear in their language and
// keys not yet translated (prod gets them from Crowdin) fall back to the source text instead of
// the whole app staying in English; mirrors getCrowdinMessages in the web app.
export async function loadMessages(locale: Locale): Promise<Messages> {
  // Catalogs contain arrays in places; cast through unknown since
  // AbstractIntlMessages models only strings/nested maps (use-intl tolerates both).
  try {
    const catalog = (await import(`../../locales/${locale}.json`))
      .default as unknown as Messages;
    if (process.env.NODE_ENV === "development") {
      const source = (await import("../../locales/source.json"))
        .default as unknown as Messages;
      return mergeMessages(source, catalog);
    }
    return catalog;
  } catch (error) {
    console.error(`Error loading translations for ${locale}:`, error);
    return (await import("../../locales/source.json"))
      .default as unknown as Messages;
  }
}
