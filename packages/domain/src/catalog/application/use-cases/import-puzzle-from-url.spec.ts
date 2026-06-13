import { beforeEach, describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../shared-kernel";
import { StorePageFetchError } from "../../domain";
import {
  FakePuzzleMatchLookup,
  FakeStorePageFetcher,
  FixedClock,
  InMemoryImportDraftCache,
} from "../testing";
import { makeImportPuzzleFromUrl } from "./import-puzzle-from-url";

const NOW = new Date("2026-06-13T10:00:00Z");
const URL_IN = "https://Shop.Example.com/p/1?utm_source=x";
const NORMALIZED = "https://shop.example.com/p/1";

describe("makeImportPuzzleFromUrl", () => {
  let fetcher: FakeStorePageFetcher;
  let cache: InMemoryImportDraftCache;
  let lookup: FakePuzzleMatchLookup;

  const run = () =>
    makeImportPuzzleFromUrl({
      fetcher,
      cache,
      lookup,
      clock: new FixedClock(NOW),
    });

  beforeEach(() => {
    fetcher = new FakeStorePageFetcher();
    cache = new InMemoryImportDraftCache();
    lookup = new FakePuzzleMatchLookup();
  });

  it("fetches, extracts a draft, caches under the normalized url, and looks up a match", async () => {
    fetcher.seedPage({
      ogImages: [],
      jsonLdProducts: [{ name: "Puzzle 1000 pieces", gtin13: "4005556150007" }],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.draft.title).toBe("Puzzle 1000 pieces");
    expect(result.value.match).toBeNull();
    expect(result.value.cached).toBe(false);
    expect(fetcher.calls).toEqual([URL_IN]);
    expect(lookup.calls).toEqual([{ ean: "4005556150007", upc: undefined }]);
    expect(await cache.get(NORMALIZED)).not.toBeNull();
  });

  it("serves a fresh cached draft without fetching", async () => {
    cache.seed(
      NORMALIZED,
      { title: "Cached", sourceUrl: NORMALIZED, images: [] },
      new Date(NOW.getTime() - 1000),
    );
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("Cached");
    expect(isOk(result) && result.value.cached).toBe(true);
    expect(fetcher.calls).toEqual([]);
  });

  it("re-fetches when the cached draft is older than the TTL", async () => {
    cache.seed(
      NORMALIZED,
      { title: "Stale", sourceUrl: NORMALIZED, images: [] },
      new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
    );
    fetcher.seedPage({ ogImages: [], jsonLdProducts: [{ name: "Fresh" }] });
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("Fresh");
    expect(fetcher.calls).toEqual([URL_IN]);
  });

  it("propagates a fetch error", async () => {
    fetcher.seedError(StorePageFetchError.timeout(URL_IN));
    const result = await run()({ url: URL_IN });
    expect(isErr(result) && result.error.code).toBe("Timeout");
  });

  it("returns InvalidUrl for an unparseable url without fetching", async () => {
    const result = await run()({ url: "not a url" });
    expect(isErr(result) && result.error.code).toBe("InvalidUrl");
    expect(fetcher.calls).toEqual([]);
  });

  it("re-fetches when the cached draft is exactly TTL old (boundary)", async () => {
    cache.seed(
      NORMALIZED,
      { title: "AtBoundary", sourceUrl: NORMALIZED, images: [] },
      new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
    );
    fetcher.seedPage({
      ogImages: [],
      jsonLdProducts: [{ name: "BoundaryFresh" }],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("BoundaryFresh");
    expect(fetcher.calls).toEqual([URL_IN]);
  });

  it("returns a match when a barcode is found in the catalog", async () => {
    fetcher.seedPage({
      ogImages: [],
      jsonLdProducts: [{ name: "Ravensburger X", gtin13: "4005556150007" }],
    });
    lookup.seedMatch({
      puzzleId: "p1",
      title: "Ravensburger X",
      pieceCount: 1000,
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.match?.puzzleId).toBe("p1");
  });

  it("skips the barcode lookup when the draft has no ean/upc", async () => {
    fetcher.seedPage({
      ogImages: [],
      jsonLdProducts: [{ name: "No Barcode Puzzle" }],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.match).toBeNull();
    expect(lookup.calls).toEqual([]);
  });

  it("does not cache an empty extraction (no title, no images)", async () => {
    fetcher.seedPage({ ogImages: [], jsonLdProducts: [] });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.draft.title).toBe("");
    expect(result.value.draft.images).toEqual([]);
    expect(await cache.get(NORMALIZED)).toBeNull();
  });

  it("ignores a fresh-but-empty cached draft and re-fetches", async () => {
    cache.seed(
      NORMALIZED,
      { title: "", sourceUrl: NORMALIZED, images: [] },
      new Date(NOW.getTime() - 1000),
    );
    fetcher.seedPage({ ogImages: [], jsonLdProducts: [{ name: "Recovered" }] });
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("Recovered");
    expect(fetcher.calls).toEqual([URL_IN]);
  });

  // --- diagnostics on a freshly fetched (non-cached) result ---
  it("reports fetched diagnostics with the raw source and exact counts", async () => {
    fetcher.seedPage({
      source: "jsonld",
      ogImages: [
        "https://img.example.com/a.jpg",
        "https://img.example.com/b.jpg",
      ],
      jsonLdProducts: [
        {
          name: "Puzzle 1000 pieces",
          image: ["https://img.example.com/jl1.jpg"],
        },
        { name: "Second product" },
      ],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.diagnostics.source).toBe("jsonld");
    expect(result.value.diagnostics.jsonLdProducts).toBe(2);
    expect(result.value.diagnostics.ogImages).toBe(2);
    // JSON-LD image (1) + OG images (2), deduplicated = 3
    expect(result.value.diagnostics.images).toBe(3);
  });

  it("falls back to 'unknown' source when the fetched page has no source", async () => {
    fetcher.seedPage({
      ogImages: [],
      jsonLdProducts: [{ name: "Sourceless Puzzle" }],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.diagnostics.source).toBe("unknown");
    expect(result.value.diagnostics.jsonLdProducts).toBe(1);
    expect(result.value.diagnostics.ogImages).toBe(0);
    expect(result.value.diagnostics.images).toBe(0);
  });

  it("keeps an empty-string raw source verbatim (does not coerce to 'unknown')", async () => {
    fetcher.seedPage({
      source: "",
      ogImages: [],
      jsonLdProducts: [{ name: "Empty Source Puzzle" }],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // raw.source ?? "unknown" -> "" is not null/undefined, so it stays "".
    expect(result.value.diagnostics.source).toBe("");
  });

  // --- diagnostics on a cache-served result ---
  it("reports cache diagnostics (source 'cache', zero JSON-LD/OG, image count from draft)", async () => {
    cache.seed(
      NORMALIZED,
      {
        title: "Cached",
        sourceUrl: NORMALIZED,
        images: [
          "https://img.example.com/c1.jpg",
          "https://img.example.com/c2.jpg",
        ],
      },
      new Date(NOW.getTime() - 1000),
    );
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.cached).toBe(true);
    expect(result.value.diagnostics.source).toBe("cache");
    expect(result.value.diagnostics.jsonLdProducts).toBe(0);
    expect(result.value.diagnostics.ogImages).toBe(0);
    expect(result.value.diagnostics.images).toBe(2);
    expect(fetcher.calls).toEqual([]);
  });

  // --- cached-usable condition: images-only branch (title is empty) ---
  it("serves a fresh cached draft that has images but no title", async () => {
    cache.seed(
      NORMALIZED,
      {
        // Empty (falsy) title so the cached-usable check relies on the images branch.
        // Kills the `... || images.length > 0` -> `cached.draft.title` mutant.
        title: "",
        sourceUrl: NORMALIZED,
        images: ["https://img.example.com/only.jpg"],
      },
      new Date(NOW.getTime() - 1000),
    );
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.cached).toBe(true);
    expect(result.value.diagnostics.source).toBe("cache");
    expect(result.value.diagnostics.images).toBe(1);
    expect(fetcher.calls).toEqual([]);
  });

  // --- put-only-when-non-empty: caches an images-only (no title) extraction ---
  it("caches an extraction that has images but no title", async () => {
    fetcher.seedPage({
      ogImages: ["https://img.example.com/x.jpg"],
      jsonLdProducts: [],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.draft.title).toBe("");
    expect(result.value.draft.images).toEqual([
      "https://img.example.com/x.jpg",
    ]);
    expect(await cache.get(NORMALIZED)).not.toBeNull();
  });

  // --- TTL magnitude: a draft just under a week old is still fresh ---
  it("serves a cached draft that is just under the 7-day TTL", async () => {
    cache.seed(
      NORMALIZED,
      { title: "AlmostStale", sourceUrl: NORMALIZED, images: [] },
      new Date(NOW.getTime() - (7 * 24 * 60 * 60 * 1000 - 1)),
    );
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.cached).toBe(true);
    expect(result.value.draft.title).toBe("AlmostStale");
    expect(fetcher.calls).toEqual([]);
  });

  // --- barcode lookup gating: upc-only still triggers the lookup ---
  it("looks up a match when only a upc (gtin12) is present", async () => {
    fetcher.seedPage({
      ogImages: [],
      jsonLdProducts: [{ name: "Upc Only Puzzle", gtin12: "036000291452" }],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.draft.ean).toBeUndefined();
    expect(result.value.draft.upc).toBe("036000291452");
    expect(lookup.calls).toEqual([{ ean: undefined, upc: "036000291452" }]);
  });

  it("ignores a fresh cached draft whose title is only whitespace and re-fetches", async () => {
    // The usability check trims the cached title, so a whitespace-only title with no images counts
    // as empty and must trigger a re-fetch rather than serving the blank cached draft.
    cache.seed(
      NORMALIZED,
      { title: "   ", sourceUrl: NORMALIZED, images: [] },
      new Date(NOW.getTime() - 1000),
    );
    fetcher.seedPage({ ogImages: [], jsonLdProducts: [{ name: "Recovered" }] });
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("Recovered");
    expect(fetcher.calls).toEqual([URL_IN]);
  });
});
