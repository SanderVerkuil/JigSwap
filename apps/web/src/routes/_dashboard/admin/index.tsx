import {
  ADMIN_COUNTED_NAV_KEYS,
  adminNavCount,
} from "@/components/admin/pending-counts";
import { GroupLanding } from "@/components/dashboard-layout/group-landing";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import type { QueueCount } from "@/lib/queue-count";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/admin/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "admin") }],
  }),
  component: AdminLandingPage,
});

// "Admin" landing: the directory of the admin surfaces (moderation, categories,
// contact triage, docs feedback). Reached from the gated sidebar group label —
// and on mobile it is the admin hub (the tab bar carries no admin entry), so
// its tiles carry the work waiting in their queues, as the sidebar items do.
// The page title/subtitle render in the shell page head.
function AdminLandingPage() {
  const { data: pendingCounts } = useQuery(
    convexQuery(gateway.admin.pendingCounts, {}),
  );
  const counts: Record<string, QueueCount | undefined> = {};
  if (pendingCounts) {
    for (const key of ADMIN_COUNTED_NAV_KEYS) {
      counts[key] = adminNavCount(key, pendingCounts);
    }
  }
  return <GroupLanding group="admin" counts={counts} />;
}
