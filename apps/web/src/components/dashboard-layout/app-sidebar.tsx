"use client";

// Grouped navigation sidebar: the long arm of the sky L-frame below the global
// top bar, with no brand lockup (that lives in the top bar) and no border walls.
// Group names are serif links to their landing pages (/library, /community and
// /admin; the admin group renders only for backend-confirmed admins). A gable
// skyline stands at the foot, behind What's new and the account row.
import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { StreetSkyline } from "@/components/common/street-skyline";
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
import { WhatsNewNavItem } from "@/components/whats-new/badges";
import { useWhatsNewUnreadCount } from "@/components/whats-new/use-whats-new-state";
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
      // Slot the fixed desktop sidebar below the 48px global top bar.
      className="top-12 h-[calc(100svh-3rem)]"
    >
      <SidebarSkyline />
      {/* Positioned so the nav and the footer rows paint above the skyline. */}
      <SidebarContent className="relative [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_45%,transparent)_transparent] [scrollbar-width:thin]">
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

      {/* From 720px tall the top padding clears the skyline's windows, so nothing
          lit sits behind a label and a long nav scrolls above them. The footer rows
          stand on the skyline's tone, which in the light theme equals the nav's hover
          tone, so they hover with a tint that shows on it and on the bare frame. */}
      <SidebarFooter className="relative gap-0.5 px-2 pt-2 pb-0 group-data-[collapsible=icon]:pt-2 [@media(min-height:720px)]:pt-9 [@media(hover:hover)]:[&_[data-slot=sidebar-menu-button]:not([data-active=true]):hover]:bg-sidebar-foreground/8">
        <SidebarMenu>
          <WhatsNewNavItem
            count={whatsNewCount}
            active={pathname === "/whats-new"}
          />
        </SidebarMenu>
        <UserFooter />
      </SidebarFooter>
    </Sidebar>
  );
}

// The signature: a tone-on-tone row of gables at the sidebar's foot, drawn 1:1 and cropped by the
// sidebar's width. It stands on a solid band of its own tone, tall enough to lift every window above
// the footer rows, so a window lit at night never sits behind text. Hidden in the icon rail and on
// short windows, where the nav needs the room.
function SidebarSkyline() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 hidden overflow-hidden text-sidebar-skyline [--skyline-window:var(--sidebar-skyline-window)] group-data-[collapsible=icon]:hidden [@media(min-height:720px)]:block"
    >
      <StreetSkyline className="h-[120px] w-[480px] max-w-none" />
      <div className="h-11 bg-current" />
    </div>
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
            "underline-offset-4 hover:underline",
            groupActive && "underline",
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
