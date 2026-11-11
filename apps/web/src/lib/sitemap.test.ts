import { describe, expect, it, vi } from "vitest";
import {
  buildSitemapXml,
  collectSitemapEntries,
  docsSitemapPaths,
  SITEMAP_CACHE_CONTROL,
  SITEMAP_MAX_URLS,
  sitemapResponse,
  type SitemapEntry,
  type SitemapPage,
} from "./sitemap";

const ORIGIN = "https://jigswap.site";

const entry = (n: number): SitemapEntry => ({
  id: `def${n}`,
  updatedAt: Date.UTC(2026, 9, 1) + n * 1000,
});

// A fake listSitemapEntries feed over `total` entries, `size` per page, keyed by a numeric cursor.
const feed = (total: number, size: number) =>
  vi.fn(async (cursor: string | null): Promise<SitemapPage> => {
    const start = cursor === null ? 0 : Number(cursor);
    const end = Math.min(total, start + size);
    return {
      page: Array.from({ length: end - start }, (_, i) => entry(start + i)),
      isDone: end >= total,
      continueCursor: String(end),
    };
  });

describe("collectSitemapEntries", () => {
  it("walks every page in order until the feed is done", async () => {
    const fetchPage = feed(5, 2);

    const entries = await collectSitemapEntries(fetchPage);

    expect(entries).toEqual([0, 1, 2, 3, 4].map(entry));
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      null,
      "2",
      "4",
    ]);
  });

  it("stops at the URL cap without fetching further pages", async () => {
    const fetchPage = feed(100, 10);

    const entries = await collectSitemapEntries(fetchPage, 25);

    expect(entries).toEqual(Array.from({ length: 25 }, (_, i) => entry(i)));
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("leaves room for the /catalog root under the 50,000-URL sitemap limit by default", async () => {
    const fetchPage = feed(60_000, 1000);

    const entries = await collectSitemapEntries(fetchPage);

    expect(entries).toHaveLength(49_999);
  });
});

describe("buildSitemapXml", () => {
  it("renders the /catalog root plus one <url> per definition with its lastmod", () => {
    expect(buildSitemapXml(ORIGIN, [entry(0), entry(1)])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://jigswap.site/catalog</loc></url>",
        "  <url><loc>https://jigswap.site/catalog/def0</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod></url>",
        "  <url><loc>https://jigswap.site/catalog/def1</loc><lastmod>2026-10-01T00:00:01.000Z</lastmod></url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });

  it("lists the given paths after the /catalog root", () => {
    expect(
      buildSitemapXml(ORIGIN, [entry(0)], ["/docs", "/docs/help/faq"]),
    ).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://jigswap.site/catalog</loc></url>",
        "  <url><loc>https://jigswap.site/docs</loc></url>",
        "  <url><loc>https://jigswap.site/docs/help/faq</loc></url>",
        "  <url><loc>https://jigswap.site/catalog/def0</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod></url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });
});

describe("docsSitemapPaths", () => {
  const page = (locale: string, slug: string, isIndex = false) => ({
    locale,
    slug,
    isIndex,
  });

  it("lists the docs landing and each English article, without the group pages", () => {
    expect(
      docsSitemapPaths([
        page("en", "", true),
        page("en", "help", true),
        page("en", "help/faq-and-troubleshooting"),
        page("en", "getting-started/dashboard"),
        // One URL serves both languages, so a Dutch page adds none.
        page("nl", "help/faq-and-troubleshooting"),
      ]),
    ).toEqual([
      "/docs",
      "/docs/help/faq-and-troubleshooting",
      "/docs/getting-started/dashboard",
    ]);
  });
});

describe("sitemapResponse", () => {
  it("serves the whole catalogue as XML, cached at the edge", async () => {
    const res = await sitemapResponse(ORIGIN, feed(3, 2));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(res.headers.get("Cache-Control")).toBe(SITEMAP_CACHE_CONTROL);
    expect(SITEMAP_CACHE_CONTROL).toBe(
      "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    );
    expect(await res.text()).toBe(
      buildSitemapXml(ORIGIN, [entry(0), entry(1), entry(2)]),
    );
  });

  it("falls back to the /catalog root, never cached, when the feed fails", async () => {
    // Fails on the second page: a partial catalogue is not served either.
    const fetchPage = vi.fn(async (cursor: string | null) => {
      if (cursor !== null) throw new Error("Convex unreachable");
      return { page: [entry(0)], isDone: false, continueCursor: "1" };
    });

    const res = await sitemapResponse(ORIGIN, fetchPage);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe(buildSitemapXml(ORIGIN, []));
  });

  const DOCS = ["/docs", "/docs/help/faq-and-troubleshooting"];

  it("serves the docs paths with the catalogue", async () => {
    const res = await sitemapResponse(ORIGIN, feed(2, 2), DOCS);

    expect(await res.text()).toBe(
      buildSitemapXml(ORIGIN, [entry(0), entry(1)], DOCS),
    );
  });

  it("keeps the docs paths when the feed fails", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("Convex unreachable");
    });

    const res = await sitemapResponse(ORIGIN, fetchPage, DOCS);

    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe(buildSitemapXml(ORIGIN, [], DOCS));
  });

  it("makes room for the docs paths under the 50,000-URL limit", async () => {
    const res = await sitemapResponse(ORIGIN, feed(60_000, 1000), DOCS);

    const urls = (await res.text()).match(/<url>/g) ?? [];
    expect(urls).toHaveLength(SITEMAP_MAX_URLS);
  });
});
