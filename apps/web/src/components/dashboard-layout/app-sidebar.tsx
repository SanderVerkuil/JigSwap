"use client";

// Grouped navigation sidebar. It sits transparently on the tinted chrome
// surface below the global top bar — no brand lockup (that lives in the top
// bar) and no border walls. Group labels are small uppercase mono labels
// that link to their landing pages (/library, /community).

import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
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
} from "@/components/ui/sidebar";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { useTranslations } from "use-intl";
import { DASHBOARD_ITEM, NAV_GROUPS, type ShellNavItem } from "./route-meta";
import { UserFooter } from "./user-footer";

export function AppSidebar() {
  const t = useTranslations("shell");
  const pathname = usePathname();

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
        {NAV_GROUPS.map((group) => {
          const groupActive = pathname === group.href;
          return (
            <SidebarGroup key={group.key}>
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
        })}
      </SidebarContent>

      <SidebarFooter>
        <UserFooter />
      </SidebarFooter>
    </Sidebar>
  );
}

function NavLink({ item }: { item: ShellNavItem }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const title = t(`pages.${item.key}.title`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link href={item.href}>
          <item.icon />
          <span>{title}</span>
        </Link>
      </SidebarMenuButton>
      {item.key === "messages" && <MessagesUnreadBadge />}
    </SidebarMenuItem>
  );
}

// Live unread-messages count on the Messages nav item. The backend caps the
// total at 50, so a value of 50 genuinely means "50 or more" and reads "50+".
function MessagesUnreadBadge() {
  const t = useTranslations("messages");
  const { member } = useCurrentMember();
  const unread =
    useQuery(gateway.conversation.getUnreadTotal, member?._id ? {} : "skip") ??
    0;

  if (unread === 0) return null;
  return (
    <SidebarMenuBadge
      className="bg-jigsaw-primary-accent rounded-full text-white"
      aria-label={t("unreadCount", { count: unread })}
    >
      {unread >= 50 ? "50+" : unread}
    </SidebarMenuBadge>
  );
}
