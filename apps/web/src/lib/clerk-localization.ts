import { useCallback, useSyncExternalStore } from "react";
import type { Locale } from "./i18n";

type ClerkLocalization =
  (typeof import("./clerk-localization-nl"))["nlNLLocalization"];

// Clerk's own UI strings are English, so only the other app locales need a resource. Each is a
// separate chunk, fetched the first time that locale renders, so no locale's strings sit in the
// entry bundle.
const loaders: Partial<Record<Locale, () => Promise<ClerkLocalization>>> = {
  nl: () =>
    import("./clerk-localization-nl").then((module) => module.nlNLLocalization),
};

const loaded = new Map<Locale, ClerkLocalization>();
const pending = new Map<Locale, Promise<ClerkLocalization | undefined>>();
const listeners = new Set<() => void>();

/** Fetches (once) Clerk's resource for `locale`; undefined for English or when it fails to load. */
export function loadClerkLocalization(
  locale: Locale,
): Promise<ClerkLocalization | undefined> {
  const loader = loaders[locale];
  if (!loader) return Promise.resolve(undefined);
  let promise = pending.get(locale);
  if (!promise) {
    promise = loader().then(
      (resource) => {
        loaded.set(locale, resource);
        for (const listener of listeners) listener();
        return resource;
      },
      (error: unknown) => {
        // Clerk stays English; the next render of this locale retries.
        pending.delete(locale);
        console.error(`Failed to load Clerk strings for ${locale}:`, error);
        return undefined;
      },
    );
    pending.set(locale, promise);
  }
  return promise;
}

/**
 * Clerk's `localization` for the active app locale: undefined (Clerk's built-in English) until
 * the locale's resource has loaded, and always on the server. Clerk renders no localized markup
 * during SSR, so switching after hydration causes no mismatch.
 */
export function useClerkLocalization(
  locale: Locale,
): ClerkLocalization | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      void loadClerkLocalization(locale);
      return () => {
        listeners.delete(onChange);
      };
    },
    [locale],
  );
  return useSyncExternalStore(
    subscribe,
    () => loaded.get(locale),
    () => undefined,
  );
}
