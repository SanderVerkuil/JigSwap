import { gateway } from "@/gateway";
import {
  docsSitemapPaths,
  SITEMAP_PAGE_SIZE,
  sitemapResponse,
} from "@/lib/sitemap";
import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";

// Catalog and docs URLs ONLY: public member profiles are indexable but never sitemap-listed
// (Phase 5 spec); private member teasers carry noindex. Catalog data comes from the
// unauthenticated, paginated listSitemapEntries query via a plain HTTP client (same pattern as
// lib/require-admin.ts, minus auth); the docs come from the docs page list. lib/sitemap.ts walks
// the pages, renders the XML, sets the edge cache and the fallback.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const convex = new ConvexHttpClient(
          import.meta.env.VITE_CONVEX_URL as string,
        );
        // Imported here so the docs page list stays out of the route tree's chunk.
        const { pages } = await import("virtual:docs");
        return sitemapResponse(
          origin,
          (cursor) =>
            convex.query(gateway.catalog.sitemapEntries, {
              paginationOpts: { numItems: SITEMAP_PAGE_SIZE, cursor },
            }),
          docsSitemapPaths(pages),
        );
      },
    },
  },
});
