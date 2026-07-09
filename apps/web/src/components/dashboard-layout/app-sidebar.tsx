"use client";

// Grouped navigation sidebar. It sits transparently on the tinted chrome
// surface below the global top bar — no brand lockup (that lives in the top
// bar) and no border walls. Group labels are small uppercase mono labels
// that link to their landing pages (/library, /community, /admin — the admin
// group renders only for backend-confirmed admins).

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { usePageHeaderContent } from "@/components/dashboard-layout/page-header-slot";
import { formatUnreadCount } from "@/components/messaging/format";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import {
  ADMIN_GROUP,
  DASHBOARD_ITEM,
  NAV_GROUPS,
  type ShellNavGroup,
  type ShellNavItem,
} from "./route-meta";
import { UserFooter } from "./user-footer";

export function AppSidebar() {
  const { user } = useUser();

  // Backend-confirmed admin role — the same source the /admin route guard uses,
  // so the nav and the routes can't diverge. Convex dedupes the subscription.
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );

  return (
    <Sidebar
      variant="inset"
      collapsible="icon"
      // Slot the fixed desktop sidebar below the 56px global top bar.
      className="top-14 h-[calc(100svh-3.5rem)]"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <NavLink item={DASHBOARD_ITEM} />
          </SidebarMenu>
        </SidebarGroup>
        {NAV_GROUPS.map((group) => (
          <NavGroup key={group.key} group={group} />
        ))}
        {isAdmin && (
          <>
            <SidebarSeparator />
            <NavGroup group={ADMIN_GROUP} />
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <UserFooter />
      </SidebarFooter>
    </Sidebar>
  );
}

function NavGroup({ group }: { group: ShellNavGroup }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const groupActive = pathname === group.href;

  return (
    <SidebarGroup>
      <SidebarGroupLabel asChild>
        <Link
          href={group.href}
          className={cn(
            "font-mono text-[10px] font-medium tracking-[0.09em] uppercase transition-colors hover:text-sidebar-accent-foreground",
            groupActive && "text-sidebar-accent-foreground",
          )}
        >
          {t(`groups.${group.key}.label`)}
        </Link>
      </SidebarGroupLabel>
      <SidebarMenu>
        {group.items.map((item) => (
          <NavLink key={item.key} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavLink({ item }: { item: ShellNavItem }) {
  const t = useTranslations("shell");
  const tMessages = useTranslations("messages");
  const pathname = usePathname();
  // A page can override the pathname-derived highlight (e.g. a copy page highlights
  // My Puzzles or Browse depending on ownership, neither of which matches /copies/$id).
  const { activeNavKey } = usePageHeaderContent();
  const active = activeNavKey
    ? activeNavKey === item.key
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const title = t(`pages.${item.key}.title`);

  // Live unread-messages total, subscribed for the Messages item only (every
  // other item skips). The backend caps the value at 50, so 50 genuinely
  // means "50 or more" and renders "50+".
  const { member } = useCurrentMember();
  const { data: unreadTotal } = useQuery(
    convexQuery(
      gateway.conversation.getUnreadTotal,
      item.key === "messages" && member?._id ? {} : "skip",
    ),
  );
  const unread = unreadTotal ?? 0;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link href={item.href}>
          <item.icon />
          <span>{title}</span>
          {unread > 0 && (
            // Inside the link so screen readers announce the count with it;
            // the visual pill below stays aria-hidden.
            <span className="sr-only">
              {tMessages("unreadCount", { count: unread })}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
      {unread > 0 && (
        <SidebarMenuBadge
          aria-hidden
          className="bg-jigsaw-primary-accent rounded-full text-white"
        >
          {formatUnreadCount(unread)}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}
