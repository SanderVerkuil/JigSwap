"use client";

// Slim mobile top bar (replaces the desktop chrome below the md breakpoint):
// brand lockup on the dashboard, a back chevron to the parent section landing
// on deep pages (instead of breadcrumbs), just the title on landings/profile;
// then search (command palette), notifications and the profile avatar on the
// right. Every control is a 44px touch target and the bar is safe-area padded
// for notched phones.

import { useUser } from "@/compat/clerk";
import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import logoIcon from "@/components/common/header-icon/logo.png";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronLeft, Search } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePageHeaderContent } from "./page-header-slot";
import { getNavGroup, getRouteMeta } from "./route-meta";
import { ShellUserButton } from "./shell-user-button";

// Shared 44px touch target for every control in the bar.
const tapTarget =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent";

export function MobileTopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const t = useTranslations("shell");
  const tNotifications = useTranslations("notifications");
  const pathname = usePathname();
  const { user } = useUser();

  // Same reactive count the desktop bell subscribes to — Convex dedupes it.
  const { data: unreadCount } = useQuery(
    convexQuery(gateway.notifications.unreadCount, user?.id ? {} : "skip"),
  );
  const unread = unreadCount ?? 0;

  const meta = getRouteMeta(pathname);
  const isHome = meta?.variant === "dashboard";
  // Deep pages (a route with a parent section) trade the breadcrumb row for a
  // back chevron to the section landing; landings/profile show only a title.
  const group =
    meta?.group && meta.variant === undefined
      ? getNavGroup(meta.group)
      : undefined;
  // A page-published title (dynamic routes) overrides the static route title,
  // same precedence as the desktop page head.
  const { title: publishedTitle } = usePageHeaderContent();
  const title =
    publishedTitle ??
    (meta && !isHome ? t(`pages.${meta.pageKey}.title`) : undefined);

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b bg-card pt-[env(safe-area-inset-top)] md:hidden">
      <div className="flex h-14 items-center gap-1 pr-2 pl-1.5">
        {group ? (
          <Link
            href={group.href}
            aria-label={t("mobile.back", {
              section: t(`groups.${group.key}.label`),
            })}
            className={tapTarget}
          >
            <ChevronLeft className="size-[22px]" />
          </Link>
        ) : isHome ? (
          <Link
            href="/dashboard"
            className="flex h-11 shrink-0 items-center gap-2 pl-1.5"
          >
            <Image
              src={logoIcon}
              alt="JigSwap"
              className="size-7 object-contain"
            />
            <span className="font-heading text-[19px] leading-none font-bold">
              <span className="text-jigsaw-primary">Jig</span>
              <span className="text-jigsaw-secondary">Swap</span>
            </span>
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          {title && (
            <h1
              className={cn(
                "font-heading truncate text-lg font-bold",
                !group && "pl-2",
              )}
            >
              {title}
            </h1>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={t("search.label")}
          className={cn(tapTarget, "text-muted-foreground")}
        >
          <Search className="size-5" />
        </button>
        <Link
          href="/notifications"
          aria-label={tNotifications("bell")}
          className={cn(tapTarget, "relative text-muted-foreground")}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="bg-jigsaw-primary-accent ring-card absolute top-2.5 right-2.5 size-2 rounded-full ring-2" />
          )}
        </Link>
        <ShellUserButton tapTarget />
      </div>
    </header>
  );
}
