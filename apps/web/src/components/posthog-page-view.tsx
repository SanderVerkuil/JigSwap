import { useUser } from "@/compat/clerk";
import { usePathname, useSearchParams } from "@/compat/navigation";
// sanctioned convex/react exception: useConvexAuth (see tanstack-query migration spec)
import { useConvexAuth } from "convex/react";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

// Ported from apps/web/src/components/posthog-page-view.tsx: next/navigation
// hooks swapped for the compat layer; behavior (pageview capture + identify) kept.
export function PostHogPageView(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthog = usePostHog();

  const { isLoading, isAuthenticated } = useConvexAuth();
  const { user } = useUser();

  useEffect(() => {
    // Consent gate: posthog only has __loaded once initPostHog ran (i.e. the
    // visitor accepted the cookie notice). Without it, capture is a no-op.
    if (pathname && posthog && posthog.__loaded) {
      let url = window.origin + pathname;
      const query = searchParams.toString();
      if (query) {
        url += "?" + query;
      }

      posthog.capture("$pageview", {
        $current_url: url,
      });
    }
  }, [pathname, searchParams, posthog]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && user && posthog && posthog.__loaded) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        username: user.username,
      });
    }
  }, [isLoading, isAuthenticated, user, posthog]);

  return null;
}
