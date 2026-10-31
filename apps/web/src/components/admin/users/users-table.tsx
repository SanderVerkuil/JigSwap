"use client";

// The /admin/users directory table (admin.listUsers rows). Its columns follow the table's own
// width (container queries, so the dashboard sidebar's share counts), not the viewport:
// - always: the member, linking to /admin/users/$userId;
// - from @lg: Status and Role; below that their badges sit under the name;
// - from @3xl: Email; below that the email sits under the name;
// - from @4xl: Joined and Copies (the member page has both);
// - from @5xl: the row actions (community profile, role). A narrower table leaves them to the
//   member page, which has both.
// The tiers are measured so the email column keeps a readable width at every step.
// The role badge renders the DISPLAY-ONLY mirrored Clerk role (users.role); authorization is
// enforced server-side from the JWT.
import { CommunityProfileAction } from "@/components/admin/users/community-profile-action";
import { UserRoleAction } from "@/components/admin/users/user-role-action";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useFormatter, useTranslations } from "use-intl";

type AdminUserRow = FunctionReturnType<
  typeof gateway.admin.listUsers
>["page"][number];

const STATUS_ROLE_CELL = "hidden px-4 py-3 @lg:table-cell";
const EMAIL_CELL = "hidden px-4 py-3 @3xl:table-cell";
const DETAIL_CELL = "hidden px-4 py-3 @4xl:table-cell";
const ACTIONS_CELL = "hidden px-4 py-3 @5xl:table-cell";

function StatusBadge({ isActive }: { isActive: boolean }) {
  const t = useTranslations("admin.users");
  return isActive ? (
    <Badge variant="secondary">{t("active")}</Badge>
  ) : (
    <Badge variant="outline">{t("inactive")}</Badge>
  );
}

function RoleBadge({ role }: { role?: string }) {
  const t = useTranslations("admin.users");
  return role === "admin" ? <Badge>{t("adminBadge")}</Badge> : null;
}

export function UsersTable({ users }: { users: AdminUserRow[] }) {
  const t = useTranslations("admin.users");
  const displayName = useMemberDisplayName();
  const format = useFormatter();

  return (
    <div className="@container overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">{t("columns.member")}</th>
            <th className={`${EMAIL_CELL} font-medium`}>
              {t("columns.email")}
            </th>
            <th className={`${DETAIL_CELL} font-medium`}>
              {t("columns.joined")}
            </th>
            <th className={`${STATUS_ROLE_CELL} font-medium`}>
              {t("columns.status")}
            </th>
            <th className={`${STATUS_ROLE_CELL} font-medium`}>
              {t("columns.role")}
            </th>
            <th className={`${DETAIL_CELL} text-right font-medium`}>
              {t("columns.copies")}
            </th>
            <th className={ACTIONS_CELL}>
              <span className="sr-only">{t("columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user._id} className="border-b last:border-0">
              <td className="px-4 py-3">
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: user._id }}
                  className="flex min-h-11 items-center gap-3 hover:underline md:min-h-0"
                >
                  <Avatar className="size-8 shrink-0">
                    {user.avatar && (
                      <AvatarImage src={user.avatar} alt={displayName(user)} />
                    )}
                    <AvatarFallback>
                      <MemberInitial source={user} />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="font-medium break-words">
                      {displayName(user)}
                    </div>
                    {user.username && (
                      <div className="text-xs break-words text-muted-foreground">
                        @{user.username}
                      </div>
                    )}
                  </div>
                </Link>
                {/* What the hidden columns would show, under the name (indented past the
                    avatar) until the table is wide enough for them. */}
                {user.email && (
                  <div className="mt-1 pl-11 text-xs text-muted-foreground [overflow-wrap:anywhere] @3xl:hidden">
                    {user.email}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1 pl-11 @lg:hidden">
                  <StatusBadge isActive={user.isActive} />
                  <RoleBadge role={user.role} />
                </div>
              </td>
              {/* An address has no break points of its own: let it wrap anywhere, so the email
                  column is the one that gives way when the table is tight. */}
              <td
                className={`${EMAIL_CELL} text-muted-foreground [overflow-wrap:anywhere]`}
              >
                {user.email}
              </td>
              <td
                className={`${DETAIL_CELL} whitespace-nowrap text-muted-foreground`}
              >
                {format.dateTime(new Date(user.createdAt), {
                  dateStyle: "medium",
                })}
              </td>
              <td className={STATUS_ROLE_CELL}>
                <StatusBadge isActive={user.isActive} />
              </td>
              <td className={STATUS_ROLE_CELL}>
                <RoleBadge role={user.role} />
              </td>
              <td className={`${DETAIL_CELL} text-right tabular-nums`}>
                {user.ownedCopyCount}
              </td>
              <td className={`${ACTIONS_CELL} text-right`}>
                <div className="flex items-center justify-end gap-2">
                  <CommunityProfileAction
                    userId={user._id}
                    name={displayName(user)}
                    isActive={user.isActive}
                    compact
                  />
                  <UserRoleAction
                    userId={user._id}
                    name={displayName(user)}
                    role={user.role}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
