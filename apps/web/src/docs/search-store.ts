import type { DocsIndex, SearchDoc } from "./search";

// Per-locale docs search indexes, built on first use: the corpus and MiniSearch
// (./search) are fetched when someone opens the docs search, never with the
// docs pages themselves. Read through useSyncExternalStore (subscribe + get).
export function createDocsSearchStore(
  loadDocs: (locale: string) => Promise<readonly SearchDoc[]>,
) {
  const indexes = new Map<string, DocsIndex>();
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();

  return {
    load: (locale: string): Promise<void> => {
      if (indexes.has(locale)) return Promise.resolve();
      let loading = pending.get(locale);
      if (!loading) {
        loading = Promise.all([import("./search"), loadDocs(locale)])
          .then(([{ createDocsIndex }, docs]) => {
            indexes.set(locale, createDocsIndex(docs));
            for (const listener of listeners) listener();
          })
          // A failed chunk load leaves search empty; the next load() retries.
          .catch(() => undefined)
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
  };
}
