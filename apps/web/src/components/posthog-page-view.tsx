import { useUser } from "@/compat/clerk";
import { usePathname, useSearchParams } from "@/compat/navigation";
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
    if (pathname && posthog) {
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
    if (!isLoading && isAuthenticated && user && posthog) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        username: user.username,
      });
    }
  }, [isLoading, isAuthenticated, user, posthog]);

  return null;
}
