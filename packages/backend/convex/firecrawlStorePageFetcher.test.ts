import { afterEach, expect, test, vi } from "vitest";
import { firecrawlStorePageFetcher } from "./catalog/adapters/firecrawlStorePageFetcher";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("resolves a relative og:image against the requested URL", async () => {
  vi.stubEnv("FIRECRAWL_API_KEY", "key");
  const html =
    '<html><head><meta property="og:title" content="Mountain Vista"><meta property="og:image" content="/img/box.jpg"></head></html>';
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ success: true, data: { html } })),
  );

  const result = await firecrawlStorePageFetcher.fetch(
    "https://store.example.com/nl/puzzle/123",
  );

  expect(result.isOk && result.value.ogImages).toEqual([
    "https://store.example.com/img/box.jpg",
  ]);
  expect(result.isOk && result.value.source).toBe("firecrawl");
});
