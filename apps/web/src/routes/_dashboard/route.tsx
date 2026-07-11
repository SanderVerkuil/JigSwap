import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppNotFound } from "@/components/NotFound";
import { DashboardShell } from "@/components/dashboard-layout/shell";
import { InviteRedeemer } from "@/components/social/invite-redeemer";
import { DurationPromptProvider } from "@/components/solving/duration-prompt-provider";
import { PageLoading } from "@/components/ui/loading";
import { requireAuth } from "@/lib/require-auth";

// Pathless layout for the logged-in app. Auth: requireAuth reads the Clerk
// userId off the root context in beforeLoad and redirects to sign-in when
// absent. Chrome: the console-style inset shell (tinted surface + global top
// bar + transparent grouped sidebar + floating content card) lives in
// components/dashboard-layout — page titles/subtitles/breadcrumbs come from
// the central route-meta map there, so leaf routes don't touch the shell.
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: ({ context, location }) => {
    // Public-catalog handoff (Phase 5 spec): an unauthenticated visit to a member puzzle page has a
    // public equivalent — send it there instead of the sign-in wall so member-shared puzzle links
    // work for everyone. All other dashboard paths keep the sign-in redirect.
    if (!context.userId) {
      const puzzleDetail = location.pathname.match(/^\/puzzles\/([^/]+)\/?$/);
      if (puzzleDetail) {
        throw redirect({ to: "/catalog/$id", params: { id: puzzleDetail[1] } });
      }
    }
    return requireAuth({ context, location });
  },
  pendingComponent: () => <PageLoading message="Loading dashboard..." />,
  // 404 inside the app renders within the dashboard shell (this layout's Outlet).
  notFoundComponent: AppNotFound,
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <DashboardShell>
      <DurationPromptProvider>
        <InviteRedeemer />
        <Outlet />
      </DurationPromptProvider>
    </DashboardShell>
  );
}
