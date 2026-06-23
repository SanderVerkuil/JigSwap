import { convexQuery } from "@convex-dev/react-query";

import { gateway } from "@/gateway";

// Shared TanStack-Query options for the platform counts shown on the marketing landing (the hero
// trust-row member count + the stats strip). Routed through @convex-dev/react-query so the home
// route loader can PREFETCH it (queryClient.ensureQueryData) — the numbers are then SSR'd and
// present on first paint instead of flashing in after a client round-trip. globalStats is a public
// query, so it resolves on the server without auth. Both consumers use the same options object, so
// they share one cache entry.
export const globalStatsQuery = convexQuery(gateway.insights.globalStats, {});
