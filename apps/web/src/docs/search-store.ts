import type { DocsIndex, SearchDoc } from "./search";

// Per-locale docs search indexes, built on first use: the corpus and MiniSearch
// (./search) are fetched when someone opens the docs search, never with the
// docs pages themselves. Read through useSyncExternalStore (subscribe + get /
// failed).
export function createDocsSearchStore(
  loadDocs: (locale: string) => Promise<readonly SearchDoc[]>,
) {
  const indexes = new Map<string, DocsIndex>();
  const pending = new Map<string, Promise<void>>();
  // Locales whose last load failed (offline, a chunk gone after a deploy).
  const failures = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    load: (locale: string): Promise<void> => {
      if (indexes.has(locale)) return Promise.resolve();
      let loading = pending.get(locale);
      if (!loading) {
        // A retry is "loading" again, not "failed", while it runs.
        if (failures.delete(locale)) notify();
        loading = Promise.all([import("./search"), loadDocs(locale)])
          .then(([{ createDocsIndex }, docs]) => {
            indexes.set(locale, createDocsIndex(docs));
            notify();
          })
          // Search stays empty and says so; the next load() retries.
          .catch(() => {
            failures.add(locale);
            notify();
          })
          .finally(() => pending.delete(locale));
        pending.set(locale, loading);
      }
      return loading;
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (locale: string): DocsIndex | undefined => indexes.get(locale),
    failed: (locale: string): boolean => failures.has(locale),
  };
}
