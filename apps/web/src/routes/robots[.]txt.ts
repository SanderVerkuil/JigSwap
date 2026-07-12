import { createFileRoute } from "@tanstack/react-router";

// Served dynamically (not a public/ static file) so the Sitemap line can carry the request's own
// origin — no hardcoded production domain in the repo. Private member teasers are excluded from
// crawling via their per-page noindex meta (Phase 1), not here.
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin;
        const body = [
          "User-agent: *",
          "Allow: /",
          `Sitemap: ${origin}/sitemap.xml`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
