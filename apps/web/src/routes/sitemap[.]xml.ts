import { gateway } from "@/gateway";
import { SITEMAP_PAGE_SIZE, sitemapResponse } from "@/lib/sitemap";
import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";

// Catalog URLs ONLY (Phase 5 spec): public member profiles are indexable but never sitemap-listed;
// private member teasers carry noindex. Data comes from the unauthenticated, paginated
// listSitemapEntries query via a plain HTTP client (same pattern as lib/require-admin.ts, minus
// auth); lib/sitemap.ts walks the pages, renders the XML, sets the edge cache and the fallback.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const convex = new ConvexHttpClient(
          import.meta.env.VITE_CONVEX_URL as string,
        );
        return sitemapResponse(origin, (cursor) =>
          convex.query(gateway.catalog.sitemapEntries, {
            paginationOpts: { numItems: SITEMAP_PAGE_SIZE, cursor },
          }),
        );
      },
    },
  },
});
