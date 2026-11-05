import { QueueEmpty } from "@/components/admin/queue-empty";
import { StatTile } from "@/components/admin/stat-tile";
import { AuditList } from "@/components/admin/users/audit-list";
import { CommunityProfileAction } from "@/components/admin/users/community-profile-action";
import { UserRoleAction } from "@/components/admin/users/user-role-action";
import { UserSubmissions } from "@/components/admin/users/user-submissions";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { ADMIN_USER_STATS_CAP } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { UserX } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/users/$userId")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminUsers") }],
  }),
  component: AdminUserDetailPage,
});

// Everything the backend knows about one member that is admin-relevant, from
// the single admin/getUserDetail read model (gated server-side: requireMember
// + JWT isAdmin — the admin shell layout is convenience, not enforcement). The
// role badge and the UserRoleAction's grant/revoke branch read the DISPLAY-ONLY
// mirrored Clerk role; authorization never touches it.
function AdminUserDetailPage() {
  const { userId } = Route.useParams();
  const t = useTranslations("admin.users");
  const displayName = useMemberDisplayName();
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
  // Counts stop one row past ADMIN_USER_STATS_CAP: above it a tile reads "1000+", and the copies'
  // availability breakdown then counts only the copies read, so it reads "n+".
  const capped = (count: number) => ({
    value: Math.min(count, ADMIN_USER_STATS_CAP),
    atLeast: count > ADMIN_USER_STATS_CAP,
  });
  const copiesCapped = stats.copies.total > ADMIN_USER_STATS_CAP;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar className="size-16 shrink-0">
            {profile.avatar && (
              <AvatarImage src={profile.avatar} alt={displayName(profile)} />
            )}
            <AvatarFallback>
              <MemberInitial source={profile} />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">
                {displayName(profile)}
              </span>
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
          <div className="flex flex-wrap items-center gap-2">
            <CommunityProfileAction
              userId={profile._id}
              name={displayName(profile)}
              isActive={profile.isActive}
            />
            <UserRoleAction
              userId={profile._id}
              name={displayName(profile)}
              role={profile.role}
            />
          </div>
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
        <StatTile
          label={t("detail.stats.copies")}
          {...capped(stats.copies.total)}
        />
        <StatTile
          label={t("detail.stats.forTrade")}
          value={stats.copies.forTrade}
          atLeast={copiesCapped}
        />
        <StatTile
          label={t("detail.stats.forSale")}
          value={stats.copies.forSale}
          atLeast={copiesCapped}
        />
        <StatTile
          label={t("detail.stats.forLend")}
          value={stats.copies.forLend}
          atLeast={copiesCapped}
        />
        <StatTile
          label={t("detail.stats.collections")}
          {...capped(stats.collections)}
        />
        <StatTile
          label={t("detail.stats.solves")}
          {...capped(stats.completions)}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          {t("detail.submissionsTitle")}
        </h2>
        <UserSubmissions submissions={submissions} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-sm font-semibold">
              {t("detail.auditPerformedTitle")}
            </h2>
            {audit.performed.length > 0 && (
              // The list here is capped; the activity log pages through all of them.
              <Link
                to="/admin/moderation"
                search={{ tab: "activity", actor: profile._id }}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline-offset-2 hover:underline md:min-h-0"
              >
                {t("detail.auditPerformedAll")}
              </Link>
            )}
          </div>
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
