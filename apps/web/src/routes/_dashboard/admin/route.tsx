import { PageLoading } from "@/components/ui/loading";
import { requireAdmin } from "@/lib/require-admin";
import { Outlet, createFileRoute } from "@tanstack/react-router";

// Admin pages render inside the dashboard shell; this pathless-child group only
// adds the admin gate. _dashboard's requireAuth already ran (parent-then-child).
// The guard is cosmetic — every admin Convex function re-checks isAdmin server-side.
//
// requireAdmin is a server roundtrip, so THIS match owns the pending state during
// navigation — without a pendingComponent here the router keeps the previous page
// rendered while the shell nav already moved (leaf pendingComponents never get a
// chance; the delay lives in this parent's beforeLoad). pendingMs 200 keeps fast
// checks flash-free while anything slower swaps to the loading state promptly.
export const Route = createFileRoute("/_dashboard/admin")({
  beforeLoad: ({ location }) => requireAdmin({ location }),
  pendingComponent: () => <PageLoading />,
  pendingMs: 200,
  component: Outlet,
});
