// /sitemap.xml assembly, kept apart from the route so paging, the URL cap, the XML and the
// failure fallback are testable without a server.

import type { DocMeta } from "@/docs/types";

export type SitemapEntry = { id: string; updatedAt: number };
export type SitemapPage = {
  page: SitemapEntry[];
  isDone: boolean;
  continueCursor: string;
};

// The sitemaps.org protocol allows at most 50,000 URLs in one sitemap file. Past that the catalogue
// would need a sitemap index; until then the oldest definitions fill the file.
export const SITEMAP_MAX_URLS = 50_000;

// Entries asked for per listSitemapEntries call (the backend's per-page maximum).
export const SITEMAP_PAGE_SIZE = 1000;

// A rendered sitemap is the same for every visitor: Vercel's edge serves it for an hour and
// revalidates in the background for a day after that, so crawlers don't page Convex per request.
export const SITEMAP_CACHE_CONTROL =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

// Walks the cursor until the feed is done or the file is full. The /catalog root takes one URL, so
// the default leaves room for it.
export async function collectSitemapEntries(
  fetchPage: (cursor: string | null) => Promise<SitemapPage>,
  maxEntries = SITEMAP_MAX_URLS - 1,
): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];
  let cursor: string | null = null;
  while (entries.length < maxEntries) {
    const result = await fetchPage(cursor);
    entries.push(...result.page);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return entries.slice(0, maxEntries);
}

// The docs landing and every docs article, from the docs page list. One URL serves every language,
// so the English pages name them all; the group pages, which only lead to the articles, stay out.
export function docsSitemapPaths(
  pages: readonly Pick<DocMeta, "locale" | "slug" | "isIndex">[],
): string[] {
  return [
    "/docs",
    ...pages
      .filter((p) => p.locale === "en" && !p.isIndex)
      .map((p) => `/docs/${p.slug}`),
  ];
}

// The /catalog root, the given paths (the docs) and one URL per approved definition.
export function buildSitemapXml(
  origin: string,
  entries: SitemapEntry[],
  paths: readonly string[] = [],
): string {
  const urls = [
    `  <url><loc>${origin}/catalog</loc></url>`,
    ...paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`),
    ...entries.map(
      (e) =>
        `  <url><loc>${origin}/catalog/${e.id}</loc><lastmod>${new Date(e.updatedAt).toISOString()}</lastmod></url>`,
    ),
  ].join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Never 500 a public SEO route: if any page fails (Convex unreachable), still emit a valid sitemap
// with the /catalog root and the static paths so crawlers keep them indexed — but mark it no-store,
// so the edge never keeps serving that stub after Convex recovers. The static paths take their
// room under the URL cap before the catalogue does.
export async function sitemapResponse(
  origin: string,
  fetchPage: (cursor: string | null) => Promise<SitemapPage>,
  paths: readonly string[] = [],
): Promise<Response> {
  let entries: SitemapEntry[];
  let cacheControl = SITEMAP_CACHE_CONTROL;
  try {
    entries = await collectSitemapEntries(
      fetchPage,
      SITEMAP_MAX_URLS - 1 - paths.length,
    );
  } catch {
    entries = [];
    cacheControl = "no-store";
  }
  return new Response(buildSitemapXml(origin, entries, paths), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}
