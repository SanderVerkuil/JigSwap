import { requireAdmin } from "@/lib/require-admin";
import { Outlet, createFileRoute } from "@tanstack/react-router";

// Admin pages render inside the dashboard shell; this pathless-child group only
// adds the admin gate. _dashboard's requireAuth already ran (parent-then-child).
// The guard is cosmetic — every admin Convex function re-checks isAdmin server-side.
export const Route = createFileRoute("/_dashboard/admin")({
  beforeLoad: ({ location }) => requireAdmin({ location }),
  component: Outlet,
});
