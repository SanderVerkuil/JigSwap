// sanctioned convex/react exception: useConvexAuth (see tanstack-query migration spec)
import { useConvexAuth } from "convex/react";
import { useTranslations } from "use-intl";

// The marketing site's "start" link: a signed-in member isn't asked to start, this is their way
// back to their dashboard, under that name; everyone else goes to sign-up. While Convex auth is
// still resolving we return the public sign-up target (the safe default), matching the header's
// Authenticated/Unauthenticated behaviour.
export function useStartLink(): { href: string; label: string } {
  const t = useTranslations("marketing.nav");
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated
    ? { href: "/dashboard", label: t("dashboard") }
    : { href: "/sign-up", label: t("startShelf") };
}
