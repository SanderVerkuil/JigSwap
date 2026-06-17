"use client";

// Mobile bottom tab bar: the four destinations that matter (Home, Library,
// Swaps, Community) around a raised center "+" that opens the quick-action
// sheet. The tab highlight derives from the current route's parent section —
// library pages light Library, community pages light Community — except
// /trades, which lights its dedicated Swaps tab. Safe-area padded for
// home-indicator phones.

import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  ArrowLeftRight,
  BookOpen,
  LayoutDashboard,
  type LucideIcon,
  Plus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { MobileQuickSheet } from "./mobile-quick-sheet";
import { getRouteMeta } from "./route-meta";

type TabKey = "home" | "library" | "swaps" | "community";

const TABS: Array<{ key: TabKey; href: string; icon: LucideIcon }> = [
  { key: "home", href: "/dashboard", icon: LayoutDashboard },
  { key: "library", href: "/library", icon: BookOpen },
  { key: "swaps", href: "/trades", icon: ArrowLeftRight },
  { key: "community", href: "/community", icon: Users },
];

// /trades lights Swaps; every other route lights its parent section's tab.
function activeTab(pathname: string): TabKey | null {
  const meta = getRouteMeta(pathname);
  if (meta?.variant === "dashboard") return "home";
  if (pathname === "/trades" || pathname.startsWith("/trades/")) {
    return "swaps";
  }
  if (meta?.group === "library" || meta?.pageKey === "library") {
    return "library";
  }
  if (meta?.group === "community" || meta?.pageKey === "community") {
    return "community";
  }
  return null;
}

export function MobileTabBar() {
  const t = useTranslations("shell.mobile");
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const active = activeTab(pathname);

  // Incoming swap requests still awaiting an answer — the same definition the
  // dashboard's pending banner uses; Convex dedupes the shared subscription.
  const { member } = useCurrentMember();
  const exchanges = useQuery(
    gateway.exchange.forUser,
    member?._id ? {} : "skip",
  );
  const pending = (exchanges ?? []).filter(
    (exchange) =>
      exchange.userRole === "owner" && exchange.status === "proposed",
  ).length;

  return (
    <>
      <nav
        aria-label={t("tabsLabel")}
        // `relative z-30` so the raised center button (which rises above the bar
        // via -mt) is never painted over / clipped by positioned page content
        // above it. overflow-visible keeps the button's top from being clipped.
        className="fixed inset-x-0 bottom-0 z-30 grid shrink-0 grid-cols-5 items-stretch overflow-visible border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.slice(0, 2).map((tab) => (
          <TabLink key={tab.key} tab={tab} active={active} />
        ))}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={t("openQuickActions")}
            className="bg-jigsaw-primary ring-card -mt-[22px] inline-flex size-[52px] items-center justify-center rounded-full text-white shadow-[0_8px_22px_-6px_color-mix(in_oklab,var(--jigsaw-primary)_65%,transparent)] ring-4"
          >
            <Plus className="size-6" />
          </button>
        </div>
        {TABS.slice(2).map((tab) => (
          <TabLink
            key={tab.key}
            tab={tab}
            active={active}
            badge={tab.key === "swaps" ? pending : 0}
          />
        ))}
      </nav>
      <MobileQuickSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}

function TabLink({
  tab,
  active,
  badge = 0,
}: {
  tab: { key: TabKey; href: string; icon: LucideIcon };
  active: TabKey | null;
  badge?: number;
}) {
  const t = useTranslations("shell.mobile");
  const on = active === tab.key;

  return (
    <Link
      href={tab.href}
      aria-label={t(`tabs.${tab.key}`)}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center",
        on ? "text-jigsaw-primary" : "text-muted-foreground",
      )}
    >
      <span className="relative">
        <tab.icon className="size-[21px]" />
        {badge > 0 && (
          <span className="bg-jigsaw-primary-accent absolute -top-1 -right-2 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
    </Link>
  );
}
