import { useConvexAuth } from "convex/react";

// Target for the "Start trading" CTAs on the marketing site: a signed-in member goes straight to
// their dashboard, everyone else to sign-up. While Convex auth is still resolving we return the
// public sign-up target (the safe default), matching the header's Authenticated/Unauthenticated
// behaviour.
export function useStartHref(): string {
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated ? "/dashboard" : "/sign-up";
}
