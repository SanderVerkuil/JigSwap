"use client";

import { Link } from "@/compat/link";
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useTranslations } from "use-intl";
import { COUNT_PILL_COLORS } from "./category-chip";
import { formatWhatsNewCount } from "./logic";

// The unread badges (spec Part B §3). Visual counts and dots are always aria-hidden; each trigger
// carries the count in its accessible name instead. The live announcement lives in one shell-level
// region (announcer.tsx), not here, so the sidebar, sheet and menu never announce twice.

/** Sidebar footer entry above the user row (§3.1): a meta destination, not part of NAV_GROUPS. */
export function WhatsNewNavItem({
  count,
  active,
}: {
  count: number;
  active: boolean;
}) {
  const t = useTranslations("whatsNew");
  const title = t("menuLabel");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link href="/whats-new" data-tour="whats-new-entry">
          <Sparkles />
          <span>{title}</span>
          {count > 0 && (
            <span className="sr-only">{t("unreadCount", { count })}</span>
          )}
        </Link>
      </SidebarMenuButton>
      {count > 0 && (
        <>
          <SidebarMenuBadge
            aria-hidden
            className={cn("rounded-full", COUNT_PILL_COLORS)}
          >
            {formatWhatsNewCount(count)}
          </SidebarMenuBadge>
          {/* The collapsed icon rail hides SidebarMenuBadge, so show a dot on the icon. */}
          <span
            aria-hidden
            className="bg-jigsaw-primary-accent ring-sidebar pointer-events-none absolute top-1.5 right-1.5 hidden size-2 rounded-full ring-2 group-data-[collapsible=icon]:block"
          />
        </>
      )}
    </SidebarMenuItem>
  );
}

/** The count pill on the mobile quick-sheet row (§3.3). */
export function WhatsNewCountPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
        COUNT_PILL_COLORS,
      )}
    >
      {formatWhatsNewCount(count)}
    </span>
  );
}

/** The pink unread dot (non-text, so pink is fine at 8px). `ring` matches the surface below. */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-jigsaw-primary-accent pointer-events-none absolute rounded-full ring-2",
        className,
      )}
    />
  );
}
