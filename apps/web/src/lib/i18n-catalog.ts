import { getMessages, type Locale, type Messages } from "./i18n";

// The message catalogs, kept out of the HTML. They used to ride in the root beforeLoad context,
// which Start dehydrates into every document (~200 KB inline script per page, uncacheable). Each
// locale's catalog is now a content-hashed /assets file the browser caches like any other build
// asset; the root head preloads it and router.tsx hydrates only once it has loaded.

const catalogUrls = import.meta.glob<string>(
  ["../../locales/*.json", "!../../locales/source.json"],
  { query: "?url", import: "default", eager: true },
);

/** The hashed URL of `locale`'s catalog file. */
export function catalogUrl(locale: Locale): string {
  const url = catalogUrls[`../../locales/${locale}.json`];
  if (!url) throw new Error(`No message catalog for locale "${locale}"`);
  return url;
}

/**
 * Root head links that start fetching the catalog with the server-rendered document, so hydration
 * does not wait on a fetch that only starts once the scripts run. None in the browser: there the
 * catalog is always loaded before head() runs, and a preload added after a language switch would
 * go unused. None in dev: there the catalog comes from the server function (it fills untranslated
 * keys from source.json), not from the file.
 */
export function catalogPreloadLinks(locale: Locale | undefined) {
  if (!locale || import.meta.env.DEV || typeof window !== "undefined") {
    return [];
  }
  // `crossOrigin` makes the preload match the CORS-mode fetch() in fetchCatalog, so it is reused.
  return [
    {
      rel: "preload",
      as: "fetch",
      href: catalogUrl(locale),
      crossOrigin: "anonymous" as const,
    },
  ];
}

// On the server `loaded` is shared by concurrent requests. That is safe: it is keyed by locale and
// a locale's catalog is the same for every visitor (no per-request or per-member data).
const loaded = new Map<Locale, Messages>();
const pending = new Map<Locale, Promise<Messages>>();

/**
 * The loaded catalog for `locale`, read synchronously while rendering (Providers, head titles).
 * The root beforeLoad and router hydration await loadCatalog first, so the active locale's catalog
 * is always here by the time anything renders with it.
 */
export function messagesFor(locale: Locale): Messages | undefined {
  return loaded.get(locale);
}

/**
 * Loads `locale`'s catalog into messagesFor. On the server: in-process through the server
 * function, on every request (the import behind it is module-cached). In the browser: once per
 * locale, from the hashed file, falling back to the server function if that fetch fails; in dev
 * from the server function, which merges the catalog over source.json.
 */
export function loadCatalog(locale: Locale): Promise<Messages> {
  if (typeof window === "undefined") {
    return getMessages({ data: locale }).then((messages) => {
      loaded.set(locale, messages);
      return messages;
    });
  }
  const cached = loaded.get(locale);
  if (cached) return Promise.resolve(cached);
  let promise = pending.get(locale);
  if (!promise) {
    const source = import.meta.env.DEV
      ? getMessages({ data: locale })
      : fetchCatalog(locale);
    promise = source.then(
      (messages) => {
        loaded.set(locale, messages);
        return messages;
      },
      (error: unknown) => {
        // Nothing cached: the next navigation or language switch retries.
        pending.delete(locale);
        throw error;
      },
    );
    pending.set(locale, promise);
  }
  return promise;
}

async function fetchCatalog(locale: Locale): Promise<Messages> {
  try {
    const response = await fetch(catalogUrl(locale));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Catalogs contain arrays in places; use-intl tolerates them (see loadMessages).
    return (await response.json()) as Messages;
  } catch (error) {
    console.warn(
      `Loading the ${locale} catalog from the server instead:`,
      error,
    );
    return getMessages({ data: locale });
  }
}
