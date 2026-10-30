import { createServerFn } from "@tanstack/react-start";
import type { AbstractIntlMessages } from "use-intl";
import { detectLocale, loadMessages, writeLocaleCookie } from "./i18n.server";

// Mirrors apps/web/src/i18n/request.ts: same locales, cookie name, default, and
// Accept-Language negotiation — adapted from next-intl/next-headers to TanStack
// Start server primitives. The negotiation, cookie and catalog loading live in
// i18n.server.ts and are only called from the server-function handlers below,
// so none of that code (Negotiator, the locale matcher) reaches the browser.
export const locales = ["en", "nl"] as const;
export const defaultLocale = "en" as const;
export type Locale = (typeof locales)[number];

export const INTL_COOKIE_NAME = "jigswap-intl";
export const timeZone = "Europe/Amsterdam";

// use-intl's recursive message shape: serializable across the server-fn boundary
// (nested string maps, no `unknown`) and accepted directly by IntlProvider.
export type Messages = AbstractIntlMessages;

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

// Deep-merge `overlay` onto `base`: overlay wins per leaf, keys missing from the overlay keep the
// base value. Pure, for loadMessages (i18n.server.ts) and its tests.
export function mergeMessages(base: Messages, overlay: Messages): Messages {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = merged[key];
    merged[key] =
      isMessageMap(prev) && isMessageMap(value)
        ? mergeMessages(prev, value)
        : value;
  }
  return merged as Messages;
}

function isMessageMap(value: unknown): value is Messages {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocale(data: unknown): Locale {
  if (!isLocale(data as string)) {
    throw new Error(`Invalid locale: ${String(data)}`);
  }
  return data as Locale;
}

// Root beforeLoad calls this so SSR has the locale before first paint. The
// messages are not part of it: this payload is dehydrated into every document,
// so the catalog travels separately (lib/i18n-catalog.ts). `now` is the
// server's clock at render time; it travels with the dehydrated payload so SSR
// and hydration format relative times against the same instant.
export const getIntl = createServerFn({ method: "GET" }).handler(async () => {
  const locale = detectLocale();
  return { locale, timeZone, now: Date.now() };
});

// One locale's catalog. SSR loads it in-process through this; the browser only
// calls it when the hashed catalog file fails to load, or in dev (where it adds
// the source.json fallback). See lib/i18n-catalog.ts.
export const getMessages = createServerFn({ method: "GET" })
  .validator(parseLocale)
  .handler(async ({ data }) => loadMessages(data));

export type IntlPayload = Awaited<ReturnType<typeof getIntl>>;

// The locale the root beforeLoad put in a route context; undefined when it did
// not run (e.g. it failed). Takes `unknown` so the root route can read its own
// context without its types referring to themselves.
export function contextLocale(context: unknown): Locale | undefined {
  return (context as { intl?: IntlPayload } | undefined)?.intl?.locale;
}

// The locale only changes via setLocale, so client-side navigations reuse the
// payload instead of re-fetching it from the root beforeLoad on every click.
// Module state is only used in the browser — on the server it would leak
// between concurrent requests.
let intlCache: IntlPayload | null = null;

export async function getIntlCached(): Promise<IntlPayload> {
  if (typeof window !== "undefined" && intlCache) return intlCache;
  const result = await getIntl();
  if (typeof window !== "undefined") intlCache = result;
  return result;
}

// Seeds the cache from the SSR-dehydrated root context at hydration, so the
// first client-side navigation doesn't refetch the locale.
export function seedIntlCache(value: IntlPayload) {
  if (typeof window !== "undefined") intlCache ??= value;
}

// Language switchers call this before router.invalidate() so the re-run
// beforeLoad picks up the freshly selected locale (and loads its catalog).
export function clearIntlCache() {
  intlCache = null;
}

// Persists the chosen locale; the language switcher invalidates the router after
// calling this so the new catalog is re-fetched.
export const setLocale = createServerFn({ method: "POST" })
  .validator(parseLocale)
  .handler(async ({ data }) => {
    writeLocaleCookie(data);
    return { locale: data };
  });
