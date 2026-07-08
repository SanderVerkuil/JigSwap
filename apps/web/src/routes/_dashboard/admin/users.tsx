import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { QueueEmpty } from "@/components/admin/queue-empty";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Search, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/users")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminUsers") }],
  }),
  component: AdminUsersPage,
});

const PAGE_SIZE = 25;

// Read-only admin directory of every member (no user actions in v1). The role badge renders
// the DISPLAY-ONLY mirrored Clerk role (users.role); authorization is enforced server-side
// from the JWT (identity/isAdmin) in admin/listUsers — this page never gates on the mirror.
function AdminUsersPage() {
  const t = useTranslations("admin.users");
  const format = useFormatter();

  const [searchInput, setSearchInput] = useState("");
  // Debounced server search: usePaginatedQuery restarts pagination whenever its args change,
  // so only push the term once the admin stops typing.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

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
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("columns.member")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.email")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.joined")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.status")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.role")}</th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("columns.copies")}
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user._id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8 shrink-0">
                        {user.avatar && (
                          <AvatarImage src={user.avatar} alt={user.name} />
                        )}
                        <AvatarFallback>
                          {user.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{user.name}</div>
                        {user.username && (
                          <div className="text-xs text-muted-foreground">
                            @{user.username}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {format.dateTime(new Date(user.createdAt), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <Badge variant="secondary">{t("active")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("inactive")}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.role === "admin" && <Badge>{t("adminBadge")}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {user.ownedCopyCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
