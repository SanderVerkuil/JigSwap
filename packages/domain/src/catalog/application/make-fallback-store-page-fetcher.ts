import { type StorePageFetchError, type StorePageFetchErrorCode } from "../domain";
import { type StorePageFetcher } from "./ports/out/store-page-fetcher";

// Error codes worth retrying with a different fetch strategy (blocked/garbled/missing pages).
// Not retried: InvalidUrl (won't change), Timeout (already slow — don't double the wait).
const RETRYABLE: ReadonlyArray<StorePageFetchErrorCode> = [
  "Blocked",
  "NotFound",
  "FetchFailed",
  "Unparseable",
];

// Tries `primary`; if it fails with a retryable error, tries `fallback`. Returns the fallback's
// result when attempted (its error is the more recent/relevant), else the primary's result.
export const makeFallbackStorePageFetcher = (
  primary: StorePageFetcher,
  fallback: StorePageFetcher,
  shouldFallback: (e: StorePageFetchError) => boolean = (e) =>
    RETRYABLE.includes(e.code),
): StorePageFetcher => ({
  async fetch(url) {
    const first = await primary.fetch(url);
    if (first.isOk || !shouldFallback(first.error)) return first;
    return fallback.fetch(url);
  },
});
