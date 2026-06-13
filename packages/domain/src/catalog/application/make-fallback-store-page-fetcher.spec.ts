import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../shared-kernel";
import { StorePageFetchError } from "../domain";
import { FakeStorePageFetcher } from "./testing";
import { makeFallbackStorePageFetcher } from "./make-fallback-store-page-fetcher";

const URL = "https://example.com/puzzle";
const PAGE = { ogImages: [], jsonLdProducts: [] };

describe("makeFallbackStorePageFetcher", () => {
  it("returns primary result when primary succeeds — fallback NOT called", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage(PAGE);
    const fallback = new FakeStorePageFetcher();
    fallback.seedError(StorePageFetchError.fetchFailed("should not be called"));

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(primary.calls).toEqual([URL]);
    expect(fallback.calls).toEqual([]);
  });

  it("returns primary Timeout error without calling fallback (Timeout is not retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.timeout(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("Timeout");
    expect(fallback.calls).toEqual([]);
  });

  it("returns primary InvalidUrl error without calling fallback (InvalidUrl is not retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.invalidUrl(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("InvalidUrl");
    expect(fallback.calls).toEqual([]);
  });

  it("calls fallback when primary fails FetchFailed, returns fallback ok result", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.fetchFailed("connection refused"));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage({
      ogImages: ["https://example.com/img.jpg"],
      jsonLdProducts: [],
    });

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.ogImages).toEqual(["https://example.com/img.jpg"]);
    expect(primary.calls).toEqual([URL]);
    expect(fallback.calls).toEqual([URL]);
  });

  it("calls fallback when primary fails Blocked (retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.blocked(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });

  it("calls fallback when primary fails NotFound (retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.notFound(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });

  it("calls fallback when primary fails Unparseable (retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.unparseable(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });

  it("when both fail, returns fallback error (the more recent/relevant failure)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.blocked(URL, "bot-detection"));
    const fallback = new FakeStorePageFetcher();
    fallback.seedError(
      StorePageFetchError.fetchFailed(
        "browser-retry HTTP 403",
        "browser-retry: FETCH_ERROR",
      ),
    );

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    // Should return the fallback error, not the primary
    expect(result.error.code).toBe("FetchFailed");
    expect(result.error.detail).toBe("browser-retry: FETCH_ERROR");
  });

  it("accepts a custom shouldFallback predicate", async () => {
    const primary = new FakeStorePageFetcher();
    // Timeout is normally not retryable but we override the predicate
    primary.seedError(StorePageFetchError.timeout(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(
      primary,
      fallback,
      (e) => e.code === "Timeout", // custom: retry on Timeout
    );
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });
});
