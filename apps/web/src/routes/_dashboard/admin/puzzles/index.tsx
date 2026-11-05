import { AdminPuzzleList } from "@/components/admin/puzzles/admin-puzzle-list";
import {
  validateAdminPuzzlesSearch,
  type AdminPuzzlesSearch,
} from "@/components/admin/puzzles/puzzles-search";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { formatQueueCount } from "@/lib/queue-count";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Lightbulb } from "lucide-react";
import { useCallback } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/puzzles/")({
  // `?status=` and `?q=` are the filters, so Back from a definition restores the filtered list.
  validateSearch: validateAdminPuzzlesSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: AdminPuzzlesPage,
});

// Admin console over EVERY catalog definition (AdminPuzzleList): all moderation statuses, newest
// first with load-more pagination, narrowed by the status pills and the search box, both kept in
// the URL (?status=&q=). Pending rows link to their moderation item; approved rows can be
// reversibly disabled and disabled rows re-enabled via the shared PuzzleLifecycleAction (disable
// confirms; both toast with Undo); the audit trail lands in the moderation Activity Log via the
// mutations' moderationActions stamps.
function AdminPuzzlesPage() {
  const t2 = useTranslations("admin.proposals");
  const { status, q: search } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Filter changes replace the history entry and keep the scroll position: a view change on the
  // same page, not a new page.
  const replaceSearch = useCallback(
    (update: (prev: AdminPuzzlesSearch) => AdminPuzzlesSearch) =>
      void navigate({ search: update, replace: true, resetScroll: false }),
    [navigate],
  );
  // Stable, so the search box's debounce (useUrlSearchInput) is not restarted by a re-render.
  const writeSearch = useCallback(
    (term: string | undefined) =>
      replaceSearch((prev) => ({ ...prev, q: term })),
    [replaceSearch],
  );

  const { data: pendingCounts } = useQuery(
    convexQuery(gateway.admin.pendingCounts, {}),
  );
  const proposals = pendingCounts?.proposals;
  usePageHeaderActions(
    () => (
      <Button variant="outline" size="sm" asChild>
        <Link to="/admin/puzzles/proposals">
          <Lightbulb className="h-4 w-4" />
          {t2("title")}
          {proposals && proposals.count > 0
            ? ` (${formatQueueCount(proposals.count, proposals.capped)})`
            : ""}
        </Link>
      </Button>
    ),
    [proposals?.count, proposals?.capped],
  );

  return (
    <AdminPuzzleList
      status={status}
      search={search}
      onStatusChange={(next) =>
        replaceSearch((prev) => ({ ...prev, status: next }))
      }
      onSearchChange={writeSearch}
      pendingCount={pendingCounts?.submissions}
    />
  );
}
