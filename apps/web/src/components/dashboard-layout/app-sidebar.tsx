"use client";

// Grouped navigation sidebar. It sits transparently on the tinted chrome
// surface below the global top bar — no brand lockup (that lives in the top
// bar) and no border walls. Group labels are uppercase mono rows that link to
// their landing pages (/library, /community, /admin — the admin group renders
// only for backend-confirmed admins), the hubs the phone tabs open; they show
// a row background and a chevron on hover and focus so they read as links.
// Messages carries the unread count; Moderation, Puzzles and Contact carry the
// work waiting in their admin queues.
import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import {
  ADMIN_COUNTED_NAV_KEYS,
  adminNavCount,
} from "@/components/admin/pending-counts";
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
import { UnreadDot, WhatsNewNavItem } from "@/components/whats-new/badges";
import { useWhatsNewUnreadCount } from "@/components/whats-new/use-whats-new-state";
import { gateway } from "@/gateway";
import { formatQueueCount } from "@/lib/queue-count";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
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
  const t = useTranslations("shell");
  const { user } = useUser();
  const pathname = usePathname();
  const whatsNewCount = useWhatsNewUnreadCount();

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
      {/* One navigation landmark for the whole sidebar (groups, What's new, account), so
          screen-reader users can jump to it and no sidebar content sits outside a landmark. */}
      <nav
        aria-label={t("primaryNav")}
        className="flex min-h-0 flex-1 flex-col"
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
          <SidebarMenu>
            <WhatsNewNavItem
              count={whatsNewCount}
              active={pathname === "/whats-new"}
            />
          </SidebarMenu>
          <UserFooter />
        </SidebarFooter>
      </nav>
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
          aria-current={groupActive ? "page" : undefined}
          // Slot concatenates these after the primitive's classes without merging them, so the
          // active look is an aria-current variant, which wins over the base text colour.
          className="group/hub gap-2 font-mono tracking-[0.08em] uppercase hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            {t(`groups.${group.key}.label`)}
          </span>
          <ChevronRight
            aria-hidden
            className="opacity-0 transition-opacity group-hover/hub:opacity-100 group-focus-visible/hub:opacity-100"
          />
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

  // Work waiting in the item's admin queues (Moderation, Puzzles, Contact), subscribed for those
  // items only. They render in the admin group, which only backend-confirmed admins get, and the
  // query is admin-gated server-side; Convex dedupes the one subscription the items share. The
  // backend stops each count at a cap, so a capped count renders "N+".
  const { data: pendingCounts } = useQuery(
    convexQuery(
      gateway.admin.pendingCounts,
      ADMIN_COUNTED_NAV_KEYS.has(item.key) ? {} : "skip",
    ),
  );
  const waiting = pendingCounts && adminNavCount(item.key, pendingCounts);
  // Unread messages keep the pink "new for you" pill; admin work waiting gets the primary one,
  // which also keeps its small white text at AA contrast.
  const badge =
    unread > 0
      ? {
          label: formatUnreadCount(unread),
          srText: tMessages("unreadCount", { count: unread }),
          className: "bg-jigsaw-primary-accent text-white",
        }
      : waiting && waiting.count > 0
        ? {
            label: formatQueueCount(waiting.count, waiting.capped),
            srText: t("waitingCount", {
              count: waiting.count,
              capped: waiting.capped ? "yes" : "no",
            }),
            className:
              "bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-[active=true]/menu-button:text-primary-foreground",
            dotClassName: "bg-primary",
          }
        : null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link href={item.href}>
          <item.icon />
          <span>{title}</span>
          {badge && (
            // Inside the link so screen readers announce the count with it;
            // the visual pill below stays aria-hidden.
            <span className="sr-only">{badge.srText}</span>
          )}
        </Link>
      </SidebarMenuButton>
      {badge && (
        <>
          <SidebarMenuBadge
            aria-hidden
            className={cn("rounded-full", badge.className)}
          >
            {badge.label}
          </SidebarMenuBadge>
          {/* The collapsed icon rail (the tablet default) hides SidebarMenuBadge. */}
          <UnreadDot
            className={cn(
              "ring-sidebar top-1.5 right-1.5 hidden size-2 group-data-[collapsible=icon]:block",
              badge.dotClassName,
            )}
          />
        </>
      )}
    </SidebarMenuItem>
  );
}
