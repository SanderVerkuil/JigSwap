import { match } from "@formatjs/intl-localematcher";
import { createServerFn } from "@tanstack/react-start";
import {
  getCookie,
  getRequestHeader,
  setCookie,
} from "@tanstack/react-start/server";
import Negotiator from "negotiator";
import type { AbstractIntlMessages } from "use-intl";

// Mirrors apps/web/src/i18n/request.ts: same locales, cookie name, default, and
// Accept-Language negotiation — adapted from next-intl/next-headers to TanStack
// Start server primitives.
export const locales = ["en", "nl"] as const;
export const defaultLocale = "en" as const;
export type Locale = (typeof locales)[number];

export const INTL_COOKIE_NAME = "jigswap-intl";
export const timeZone = "Europe/Amsterdam";

// use-intl's recursive message shape: serializable across the server-fn boundary
// (nested string maps, no `unknown`) and accepted directly by IntlProvider.
export type Messages = AbstractIntlMessages;

function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

// Server-only: resolve the active locale from the jigswap-intl cookie, falling
// back to Accept-Language negotiation, then the default.
function detectLocale(): Locale {
  const cookie = getCookie(INTL_COOKIE_NAME);
  if (isLocale(cookie)) return cookie;

  const acceptLanguage = getRequestHeader("accept-language");
  if (acceptLanguage) {
    try {
      const languages = new Negotiator({
        headers: { "accept-language": acceptLanguage },
      }).languages();
      const matched = match(
        languages,
        locales as readonly string[],
        defaultLocale,
      );
      if (isLocale(matched)) return matched;
    } catch (error) {
      console.warn("Error matching locale:", error);
    }
  }

  return defaultLocale;
}

// Dev falls back to source.json (Crowdin OTA catalogs are populated in prod);
// mirrors getCrowdinMessages in the web app.
async function loadMessages(locale: Locale): Promise<Messages> {
  // Catalogs contain arrays in places; cast through unknown since
  // AbstractIntlMessages models only strings/nested maps (use-intl tolerates both).
  try {
    if (process.env.NODE_ENV === "development") {
      return (await import("../../locales/source.json"))
        .default as unknown as Messages;
    }
    return (await import(`../../locales/${locale}.json`))
      .default as unknown as Messages;
  } catch (error) {
    console.error(`Error loading translations for ${locale}:`, error);
    return (await import("../../locales/source.json"))
      .default as unknown as Messages;
  }
}

// Root loader calls this so SSR has locale + messages before first paint.
export const getIntl = createServerFn({ method: "GET" }).handler(async () => {
  const locale = detectLocale();
  const messages = await loadMessages(locale);
  return { locale, messages, timeZone };
});

// Persists the chosen locale; the language switcher invalidates the router after
// calling this so the new catalog is re-fetched.
export const setLocale = createServerFn({ method: "POST" })
  .validator((data: unknown): Locale => {
    if (!isLocale(data as string)) {
      throw new Error(`Invalid locale: ${String(data)}`);
    }
    return data as Locale;
  })
  .handler(async ({ data }) => {
    setCookie(INTL_COOKIE_NAME, data, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { locale: data };
  });
