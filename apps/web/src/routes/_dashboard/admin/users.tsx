import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { QueueEmpty } from "@/components/admin/queue-empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Search, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/users")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminUsers") }],
  }),
  component: AdminUsersPage,
});

const PAGE_SIZE = 25;

// Admin directory of every member. The role badge renders the DISPLAY-ONLY mirrored Clerk
// role (users.role); authorization is enforced server-side from the JWT (identity/isAdmin)
// in admin/listUsers — this page never gates on the mirror. Role management: a per-row
// grant/revoke behind an AlertDialog confirm, calling the setUserRole ACTION (Clerk write +
// mirror fast-path + audit stamp). The caller's own row shows no affordance — the server's
// CannotChangeOwnRole gate is the real enforcement, the UI just doesn't offer the foot-gun.
function AdminUsersPage() {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
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

  // The signed-in admin's own row is identified by _id (CurrentMemberView shares the
  // users table _id) so its role affordance can be hidden.
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

  const setRole = useMutation({
    mutationFn: useConvexAction(gateway.admin.setUserRole),
  });
  // Per-row busy state derived from the in-flight mutation's variables (the
  // category-list busyId idiom) — the row's button disables while its call runs.
  const busyUserId = setRole.isPending
    ? (setRole.variables?.userId ?? null)
    : null;

  // The row awaiting the role-change confirm (grant when role !== "admin", revoke otherwise).
  const [confirming, setConfirming] = useState<(typeof users)[number] | null>(
    null,
  );

  const changeRole = async (user: (typeof users)[number]) => {
    const granting = user.role !== "admin";
    try {
      await setRole.mutateAsync({
        userId: user._id as Id<"users">,
        role: granting ? "admin" : null,
      });
      toast.success(
        granting
          ? t("grantSuccess", { name: user.name })
          : t("revokeSuccess", { name: user.name }),
      );
    } catch {
      // Covers Clerk failures and the server self-guard (unreachable via this UI,
      // which hides the own-row affordance).
      toast.error(granting ? t("grantError") : t("revokeError"));
    }
  };

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
                <th className="px-4 py-3">
                  <span className="sr-only">{t("columns.actions")}</span>
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
                  <td className="px-4 py-3 text-right">
                    {me && me._id !== user._id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirming(user)}
                        disabled={busyUserId === user._id}
                        className={
                          user.role === "admin"
                            ? "text-destructive hover:text-destructive"
                            : undefined
                        }
                      >
                        {user.role === "admin"
                          ? t("removeAdmin")
                          : t("makeAdmin")}
                      </Button>
                    )}
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

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.role === "admin"
                ? t("revokeConfirmTitle", { name: confirming?.name ?? "" })
                : t("grantConfirmTitle", { name: confirming?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.role === "admin"
                ? t("revokeConfirmBody")
                : t("grantConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirming?.role === "admin"
                  ? buttonVariants({ variant: "destructive" })
                  : undefined
              }
              onClick={() => {
                if (confirming) void changeRole(confirming);
                setConfirming(null);
              }}
            >
              {confirming?.role === "admin" ? t("removeAdmin") : t("makeAdmin")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
