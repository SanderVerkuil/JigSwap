import { useUser } from "@/compat/clerk";
import { usePathname, useSearchParams } from "@/compat/navigation";
import { usePostHog } from "@/components/analytics-provider";
// sanctioned convex/react exception: useConvexAuth (see tanstack-query migration spec)
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";

// Earlier versions sent email and username with identify. Unset them on the
// member's PostHog person once per page load (SEC-59); this can go once those
// properties have been purged in PostHog itself.
let legacyPersonPropertiesUnset = false;

// Ported from apps/web/src/components/posthog-page-view.tsx: next/navigation
// hooks swapped for the compat layer; behavior (pageview capture + identify) kept.
export function PostHogPageView(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthog = usePostHog();

  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded, isSignedIn, user } = useUser();
  const userId = user?.id;

  useEffect(() => {
    // Consent gate: posthog only has __loaded once initPostHog ran (i.e. the
    // visitor accepted the cookie notice). Without it, capture is a no-op.
    if (pathname && posthog && posthog.__loaded) {
      // The query only re-triggers this effect: before_send strips it from
      // $current_url (lib/analytics-privacy.ts).
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
    if (!isLoading && isAuthenticated && userId && posthog?.__loaded) {
      // The opaque account id only: never name, email or username.
      posthog.identify(userId);
      if (!legacyPersonPropertiesUnset) {
        legacyPersonPropertiesUnset = true;
        posthog.unsetPersonProperties(["email", "username"]);
      }
    }
  }, [isLoading, isAuthenticated, userId, posthog]);

  useEffect(() => {
    // Signed out, by the menu, session expiry or another tab: give this
    // device a fresh anonymous identity, device id included (`true`), so
    // later events aren't linked to the member. Visitors who never signed in
    // keep theirs.
    if (
      isLoaded &&
      !isSignedIn &&
      posthog?.__loaded &&
      posthog.get_property("$user_state") === "identified"
    ) {
      posthog.reset(true);
    }
  }, [isLoaded, isSignedIn, posthog]);

  return null;
}
