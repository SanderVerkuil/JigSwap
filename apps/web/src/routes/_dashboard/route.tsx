import { Outlet, createFileRoute } from "@tanstack/react-router";

import { DashboardShell } from "@/components/dashboard-layout/shell";
import { PageLoading } from "@/components/ui/loading";
import { requireAuth } from "@/lib/require-auth";

// Pathless layout for the logged-in app. Auth: requireAuth reads the Clerk
// userId off the root context in beforeLoad and redirects to sign-in when
// absent. Chrome: the console-style inset shell (tinted surface + global top
// bar + transparent grouped sidebar + floating content card) lives in
// components/dashboard-layout — page titles/subtitles/breadcrumbs come from
// the central route-meta map there, so leaf routes don't touch the shell.
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: ({ context, location }) => requireAuth({ context, location }),
  pendingComponent: () => <PageLoading message="Loading dashboard..." />,
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}
