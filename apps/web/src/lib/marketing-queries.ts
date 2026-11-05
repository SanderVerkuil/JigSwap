import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";

// Shared TanStack-Query options for the platform counts shown on the marketing landing (the hero
// trust-row member count + the stats strip). Routed through @convex-dev/react-query so the home
// route loader can PREFETCH it (queryClient.ensureQueryData) — the numbers are then SSR'd and
// present on first paint instead of flashing in after a client round-trip. globalStats is a public
// query, so it resolves on the server without auth. Both consumers use the same options object, so
// they share one cache entry.
export const globalStatsQuery = convexQuery(gateway.insights.globalStats, {});

// Below this many members the live counts undersell the community ("13
// puzzlers are already swapping"), so the landing invites visitors to be among
// the first instead and hides the stats strip. Tunable; 50 is the review's
// recommendation (UX-164).
export const SOCIAL_PROOF_MIN_MEMBERS = 50;

// Whether the platform counts are big enough to show as social proof. False
// while they have not loaded, so nothing flashes before the decision is known.
export function hasSocialProof<T extends { totalUsers: number }>(
  stats: T | undefined,
): stats is T {
  return stats != null && stats.totalUsers >= SOCIAL_PROOF_MIN_MEMBERS;
}
