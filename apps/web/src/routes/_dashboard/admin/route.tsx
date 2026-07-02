import { useUser } from "@/compat/clerk";
import { PageLoading } from "@/components/ui/loading";
import { requireAdmin } from "@/lib/require-admin";
import { convexQuery } from "@convex-dev/react-query";
import { gateway } from "@jigswap/gateway";
import { useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// Admin pages render inside the dashboard shell; this pathless-child group only
// adds the admin gate. _dashboard's requireAuth already ran (parent-then-child).
// The guard is cosmetic — every admin Convex function re-checks isAdmin server-side.
//
// The gate runs in two halves so client navigation stays instant:
// - Document loads (SSR/direct URL): beforeLoad's server roundtrip redirects
//   non-admins before anything renders.
// - Client-side navigations: beforeLoad is skipped (a blocking roundtrip here
//   holds the PREVIOUS page's content while the nav shell moves on — router
//   pendingComponents don't reliably interrupt transition rendering). Instead
//   AdminGate renders in-page: the shared isAdmin subscription is already warm
//   from the sidebar's own gate, so admins see the outlet immediately; a cold
//   cache shows the loading state; non-admins get redirected home.
export const Route = createFileRoute("/_dashboard/admin")({
  beforeLoad: ({ location }) => {
    if (typeof window === "undefined") return requireAdmin({ location });
  },
  component: AdminGate,
});

function AdminGate() {
  const { user } = useUser();
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );
  const navigate = useNavigate();

  useEffect(() => {
    if (isAdmin === false) void navigate({ to: "/", replace: true });
  }, [isAdmin, navigate]);

  if (isAdmin === undefined) return <PageLoading />;
  if (isAdmin === false) return null;
  return <Outlet />;
}
