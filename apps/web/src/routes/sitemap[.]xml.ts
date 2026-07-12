import { gateway } from "@/gateway";
import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";

type SitemapEntries = FunctionReturnType<typeof gateway.catalog.sitemapEntries>;

// Catalog URLs ONLY (Phase 5 spec): public member profiles are indexable but never sitemap-listed;
// private member teasers carry noindex. Data comes from the unauthenticated listSitemapEntries
// query via a plain HTTP client (same pattern as lib/require-admin.ts, minus auth).
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const convex = new ConvexHttpClient(
          import.meta.env.VITE_CONVEX_URL as string,
        );
        // Never 500 a public SEO route: if Convex is unreachable, still emit a valid sitemap with
        // at least the /catalog root, so crawlers keep the catalogue indexed.
        let entries: SitemapEntries = [];
        try {
          entries = await convex.query(gateway.catalog.sitemapEntries, {});
        } catch {
          entries = [];
        }
        const urls = [
          `  <url><loc>${origin}/catalog</loc></url>`,
          ...entries.map(
            (e) =>
              `  <url><loc>${origin}/catalog/${e.id}</loc><lastmod>${new Date(e.updatedAt).toISOString()}</lastmod></url>`,
          ),
        ].join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
