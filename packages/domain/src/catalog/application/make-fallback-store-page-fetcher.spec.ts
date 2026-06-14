import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../shared-kernel";
import { StorePageFetchError } from "../domain";
import { makeFallbackStorePageFetcher } from "./make-fallback-store-page-fetcher";
import { FakeStorePageFetcher } from "./testing";

const URL = "https://example.com/puzzle";
const PAGE = { ogImages: [], jsonLdProducts: [] };
const PAGE_WITH_IMAGE = {
  ogImages: ["https://example.com/box.jpg"],
  jsonLdProducts: [],
};

describe("makeFallbackStorePageFetcher", () => {
  it("returns primary result when primary succeeds with an image — fallback NOT called", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage(PAGE_WITH_IMAGE);
    const fallback = new FakeStorePageFetcher();
    fallback.seedError(StorePageFetchError.fetchFailed("should not be called"));

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(primary.calls).toEqual([URL]);
    expect(fallback.calls).toEqual([]);
  });

  it("does NOT fall back when the primary already has a JSON-LD product image", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({
      ogImages: [],
      jsonLdProducts: [
        { name: "Hockey", image: "https://example.com/jsonld.jpg" },
      ],
    });
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE_WITH_IMAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([]);
  });

  it("falls back when the primary page has NO image and merges the fallback's image (keeping the primary's title)", async () => {
    const primary = new FakeStorePageFetcher();
    // Structured data gave a title but no image (the jvh-puzzels case).
    primary.seedPage({
      ogTitle: "Hockey Kampioenschappen 1000 stukjes",
      ogImages: [],
      jsonLdProducts: [{ name: "Hockey" }],
      source: "ogie",
    });
    const fallback = new FakeStorePageFetcher();
    // A later tier scraped the image from the raw HTML.
    fallback.seedPage({
      ogImages: ["https://example.com/scraped.jpg"],
      jsonLdProducts: [],
      source: "browser",
    });

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(primary.calls).toEqual([URL]);
    expect(fallback.calls).toEqual([URL]);
    // The merge keeps the primary's title + JSON-LD and ADDS the fallback's image.
    expect(result.value.ogTitle).toBe("Hockey Kampioenschappen 1000 stukjes");
    expect(result.value.jsonLdProducts).toEqual([{ name: "Hockey" }]);
    expect(result.value.ogImages).toEqual(["https://example.com/scraped.jpg"]);
    expect(result.value.source).toBe("ogie+browser");
  });

  it("gap-fills a missing title from the fallback and takes the fallback's products when the primary has none", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({ ogImages: [], jsonLdProducts: [] });
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage({
      basicTitle: "Fallback Title",
      ogImages: ["https://example.com/scraped.jpg"],
      jsonLdProducts: [{ name: "From Fallback" }],
    });

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.basicTitle).toBe("Fallback Title");
    expect(result.value.jsonLdProducts).toEqual([{ name: "From Fallback" }]);
    expect(result.value.ogImages).toEqual(["https://example.com/scraped.jpg"]);
  });

  it("keeps the image-less primary when the fallback also fails to provide one", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({
      ogTitle: "Title only",
      ogImages: [],
      jsonLdProducts: [],
    });
    const fallback = new FakeStorePageFetcher();
    fallback.seedError(StorePageFetchError.fetchFailed("no luck"));

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(fallback.calls).toEqual([URL]);
    // The primary's (image-less) result is preserved.
    expect(result.value.ogTitle).toBe("Title only");
    expect(result.value.ogImages).toEqual([]);
  });

  it("treats a JSON-LD ARRAY image as present (no fallback)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({
      ogImages: [],
      jsonLdProducts: [
        { name: "Hockey", image: ["https://example.com/a.jpg"] },
      ],
    });
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE_WITH_IMAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([]);
  });

  it("treats an empty-string image as no image (falls back)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({ ogImages: [""], jsonLdProducts: [] });
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE_WITH_IMAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(fallback.calls).toEqual([URL]);
    expect(result.value.ogImages).toContain("https://example.com/box.jpg");
  });

  it("merge: fills descriptions from the fallback, collects its ARRAY image, and keeps the single source", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({
      ogTitle: "T",
      ogImages: [],
      jsonLdProducts: [],
      source: "ogie",
    });
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage({
      ogDescription: "og-desc",
      basicDescription: "basic-desc",
      ogImages: [],
      jsonLdProducts: [
        {
          image: ["https://example.com/f1.jpg", "https://example.com/f2.jpg"],
        },
      ],
      // no `source` on the fallback: the merge keeps the primary's single source verbatim.
    });

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.ogDescription).toBe("og-desc");
    expect(result.value.basicDescription).toBe("basic-desc");
    expect(result.value.ogImages).toEqual([
      "https://example.com/f1.jpg",
      "https://example.com/f2.jpg",
    ]);
    expect(result.value.source).toBe("ogie");
  });

  it("merges imageAlts from both tiers (primary wins on conflict)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({
      ogTitle: "T",
      ogImages: [],
      jsonLdProducts: [],
      imageAlts: { "https://img/shared.jpg": "primary alt" },
    });
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage({
      ogImages: ["https://img/scraped.jpg"],
      jsonLdProducts: [],
      imageAlts: {
        "https://img/shared.jpg": "fallback alt",
        "https://img/scraped.jpg": "scraped alt",
      },
    });

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.imageAlts).toEqual({
      "https://img/shared.jpg": "primary alt",
      "https://img/scraped.jpg": "scraped alt",
    });
  });

  it("leaves imageAlts undefined when neither tier scraped any", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage({ ogTitle: "T", ogImages: [], jsonLdProducts: [] });
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage({
      ogImages: ["https://img/scraped.jpg"],
      jsonLdProducts: [],
    });

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.imageAlts).toBeUndefined();
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
