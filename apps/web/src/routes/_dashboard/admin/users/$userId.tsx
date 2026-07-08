import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { QueueEmpty } from "@/components/admin/queue-empty";
import { AuditList } from "@/components/admin/users/audit-list";
import { UserRoleAction } from "@/components/admin/users/user-role-action";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { UserX } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/users/$userId")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminUsers") }],
  }),
  component: AdminUserDetailPage,
});

// Catalog submission statuses the UI knows today; anything else (e.g. a future
// "disabled") renders as a plain outline badge with the raw status string —
// the DTO deliberately types status as string.
const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> =
  {
    approved: "secondary",
    pending: "outline",
    rejected: "destructive",
  };

// Everything the backend knows about one member that is admin-relevant, from
// the single admin/getUserDetail read model (gated server-side: requireMember
// + JWT isAdmin — the admin shell layout is convenience, not enforcement). The
// role badge and the UserRoleAction's grant/revoke branch read the DISPLAY-ONLY
// mirrored Clerk role; authorization never touches it.
function AdminUserDetailPage() {
  const { userId } = Route.useParams();
  const t = useTranslations("admin.users");
  const format = useFormatter();

  const { data, isPending, isError } = useQuery(
    convexQuery(gateway.admin.getUserDetail, {
      userId: userId as Id<"users">,
    }),
  );

  // Publish the member's name as the page-head leaf: the shell then renders
  // the route's static title as the middle crumb (Admin › Members › <name>).
  usePageHeader(() => (data ? { title: data.profile.name } : {}), [data]);

  if (isPending) {
    return <PageLoading message={t("detail.loading")} />;
  }
  // A ConvexError (unknown/deleted user id) surfaces as a query error — render
  // the admin empty-state panel rather than crashing.
  if (isError || !data) {
    return (
      <QueueEmpty
        icon={UserX}
        title={t("detail.notFoundTitle")}
        label={t("detail.notFound")}
      />
    );
  }

  const { profile, stats, submissions, audit } = data;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar className="size-16 shrink-0">
            {profile.avatar && (
              <AvatarImage src={profile.avatar} alt={profile.name} />
            )}
            <AvatarFallback>
              {profile.name
                .split(" ")
                .map((part) => part[0])
                .join("")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{profile.name}</span>
              {profile.isActive ? (
                <Badge variant="secondary">{t("active")}</Badge>
              ) : (
                <Badge variant="outline">{t("inactive")}</Badge>
              )}
              {profile.role === "admin" && <Badge>{t("adminBadge")}</Badge>}
            </div>
            {profile.username && (
              <p className="text-sm text-muted-foreground">
                @{profile.username}
              </p>
            )}
            <p className="text-sm text-muted-foreground">{profile.email}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {profile.clerkId}
            </p>
          </div>
          <UserRoleAction
            userId={profile._id}
            name={profile.name}
            role={profile.role}
          />
        </div>
        {(profile.bio || profile.location || profile.preferredLanguage) && (
          <div className="mt-4 space-y-1 border-t pt-4 text-sm">
            {profile.bio && <p>{profile.bio}</p>}
            {profile.location && (
              <p className="text-muted-foreground">
                {t("detail.location")}: {profile.location}
              </p>
            )}
            {profile.preferredLanguage && (
              <p className="text-muted-foreground">
                {t("detail.language")}: {profile.preferredLanguage}
              </p>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-4 border-t pt-4 text-xs text-muted-foreground">
          <span>
            {t("detail.joined", {
              date: format.dateTime(new Date(profile.createdAt), {
                dateStyle: "medium",
              }),
            })}
          </span>
          <span>
            {t("detail.updated", {
              date: format.dateTime(new Date(profile.updatedAt), {
                dateStyle: "medium",
              }),
            })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label={t("detail.stats.copies")} value={stats.copies.total} />
        <StatTile
          label={t("detail.stats.forTrade")}
          value={stats.copies.forTrade}
        />
        <StatTile
          label={t("detail.stats.forSale")}
          value={stats.copies.forSale}
        />
        <StatTile
          label={t("detail.stats.forLend")}
          value={stats.copies.forLend}
        />
        <StatTile
          label={t("detail.stats.collections")}
          value={stats.collections}
        />
        <StatTile label={t("detail.stats.solves")} value={stats.completions} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          {t("detail.submissionsTitle")}
        </h2>
        {submissions.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t("detail.submissionsEmpty")}
          </div>
        ) : (
          <div className="rounded-xl border bg-card px-4">
            {submissions.map((submission) => (
              <div
                key={submission._id}
                className="flex items-center gap-3 border-b py-3 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {submission.title}
                </span>
                <Badge variant={STATUS_VARIANT[submission.status] ?? "outline"}>
                  {submission.status in STATUS_VARIANT
                    ? t(`detail.status.${submission.status}`)
                    : submission.status}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {format.dateTime(new Date(submission.createdAt), {
                    dateStyle: "medium",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            {t("detail.auditPerformedTitle")}
          </h2>
          <AuditList
            entries={audit.performed}
            emptyLabel={t("detail.auditPerformedEmpty")}
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            {t("detail.auditReceivedTitle")}
          </h2>
          <AuditList
            entries={audit.received}
            emptyLabel={t("detail.auditReceivedEmpty")}
          />
        </section>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
