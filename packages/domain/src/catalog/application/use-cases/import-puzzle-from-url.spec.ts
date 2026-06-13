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
    expect(fetcher.calls).toEqual([URL_IN]);
    expect(lookup.calls).toEqual([{ ean: "4005556150007", upc: undefined }]);
    expect(await cache.get(NORMALIZED)).not.toBeNull();
  });

  it("serves a fresh cached draft without fetching", async () => {
    cache.seed(
      NORMALIZED,
      { title: "Cached", sourceUrl: NORMALIZED },
      new Date(NOW.getTime() - 1000),
    );
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("Cached");
    expect(fetcher.calls).toEqual([]);
  });

  it("re-fetches when the cached draft is older than the TTL", async () => {
    cache.seed(
      NORMALIZED,
      { title: "Stale", sourceUrl: NORMALIZED },
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
      { title: "AtBoundary", sourceUrl: NORMALIZED },
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
});
