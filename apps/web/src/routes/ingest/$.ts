import { proxyPostHog } from "@/lib/posthog-proxy";
import { createFileRoute } from "@tanstack/react-router";

// PostHog's same-origin endpoint (analytics-client.ts api_host). Only allow-listed headers
// travel either way: never the Clerk cookie to PostHog, never PostHog's cookies or CORS grants
// back to the browser. HEAD falls back to GET.
export const Route = createFileRoute("/ingest/$")({
  server: {
    handlers: {
      GET: ({ request }) => proxyPostHog(request),
      POST: ({ request }) => proxyPostHog(request),
    },
  },
});
