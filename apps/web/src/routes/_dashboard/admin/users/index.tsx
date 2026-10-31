import { QueueEmpty } from "@/components/admin/queue-empty";
import { useUrlSearchInput } from "@/components/admin/users/use-url-search-input";
import { validateAdminUsersSearch } from "@/components/admin/users/users-search";
import { UsersTable } from "@/components/admin/users/users-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Search, UserX } from "lucide-react";
import { useCallback } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/users/")({
  // `?q=` is the search, so Back from a member's page restores the filtered list.
  validateSearch: validateAdminUsersSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminUsers") }],
  }),
  component: AdminUsersPage,
});

const PAGE_SIZE = 25;

// Admin directory of every member. The role badge renders the DISPLAY-ONLY mirrored Clerk
// role (users.role); authorization is enforced server-side from the JWT (identity/isAdmin)
// in admin/listUsers — this page never gates on the mirror. The table (UsersTable) links each
// member to the detail page (/admin/users/$userId) and narrows its columns to the space it has;
// on a wide table each row also carries the shared UserRoleAction (confirm dialog +
// setUserRole action + own-row hiding).
function AdminUsersPage() {
  const t = useTranslations("admin.users");

  const { q: search } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Debounced server search: usePaginatedQuery restarts pagination whenever its args change, so
  // the term only reaches `?q=` (replacing the entry) once the admin stops typing.
  const [searchInput, setSearchInput] = useUrlSearchInput(
    search,
    useCallback(
      (term: string | undefined) =>
        void navigate({
          search: (prev) => ({ ...prev, q: term }),
          replace: true,
          resetScroll: false,
        }),
      [navigate],
    ),
  );

  const {
    results: users,
    status,
    loadMore,
    isLoading,
  } = usePaginatedQuery(gateway.admin.listUsers, search ? { search } : {}, {
    initialNumItems: PAGE_SIZE,
  });

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {status === "LoadingFirstPage" ? (
        <PageLoading message={t("loading")} />
      ) : users.length === 0 ? (
        <QueueEmpty icon={UserX} title={t("emptyTitle")} label={t("empty")} />
      ) : (
        <UsersTable users={users} />
      )}

      {status === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => loadMore(PAGE_SIZE)}
            disabled={isLoading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
