import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { GroupLanding } from "@/components/dashboard-layout/group-landing";

export const Route = createFileRoute("/_dashboard/admin/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "admin") }],
  }),
  component: AdminLandingPage,
});

// "Admin" landing: the directory of the admin surfaces (moderation, categories,
// contact triage, docs feedback). Reached from the gated sidebar group label —
// and on mobile it is the admin hub (the tab bar carries no admin entry). The
// page title/subtitle render in the shell page head.
function AdminLandingPage() {
  return <GroupLanding group="admin" />;
}
