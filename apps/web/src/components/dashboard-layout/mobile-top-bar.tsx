"use client";

// Slim mobile top bar (replaces the desktop chrome below the md breakpoint):
// brand lockup on the dashboard, a back chevron on deep pages (instead of
// breadcrumbs), just the title on landings, tab roots and the profile;
// then search (command palette), Messages (with the unread count: Messages has
// no tab of its own), notifications and the profile avatar on the right. Every
// control is a 44px touch target and the bar is safe-area padded for notched
// phones.
import { useUser } from "@/compat/clerk";
import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
// Mark-only glyph: the header-icon logo is the stacked lockup with "JigSwap"
// baked in underneath, which doubled the wordmark text beside it.
import logoMark from "@/components/marketing/assets/icon.png";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Bell, ChevronLeft, MessageSquare, Search } from "lucide-react";
import { useCallback, useSyncExternalStore, type MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { useUnreadMessageCount } from "./nav-counts";
import { usePageHeaderContent } from "./page-header-slot";
import {
  getNavGroup,
  getRouteMeta,
  isImmersiveMobileRoute,
  isMobileTabRoot,
} from "./route-meta";
import { ShellUserButton } from "./shell-user-button";
import { MOBILE_TOP_BAR_HEIGHT_VAR, useHeightCssVar } from "./sticky-offset";

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
  const unreadMessages = useUnreadMessageCount();
  const messagesTitle = t("pages.messages.title");

  const meta = getRouteMeta(pathname);
  const isHome = meta?.variant === "dashboard";
  // Deep pages (a route with a parent section) trade the breadcrumb row for a
  // back chevron; landings, the profile and the pages a tab opens (/trades sits
  // in Community but is the Swaps tab) show only a title.
  const group =
    meta?.group && meta.variant === undefined && !isMobileTabRoot(pathname)
      ? getNavGroup(meta.group)
      : undefined;
  // The chevron is a real Back: when the previous history entry is one of ours
  // (TanStack numbers only in-app entries, so canGoBack is false on a cold load
  // or after arriving from another site) it goes back there; otherwise it
  // follows its href up to the section landing. Read after mount (the server
  // has no history), so the server render and hydration use the landing label.
  const router = useRouter();
  const subscribeHistory = useCallback(
    (onChange: () => void) => router.history.subscribe(onChange),
    [router],
  );
  const canGoBack = useSyncExternalStore(
    subscribeHistory,
    () => router.history.canGoBack(),
    () => false,
  );
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    // Modified clicks keep the link (open the landing in a new tab).
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !router.history.canGoBack()
    ) {
      return;
    }
    event.preventDefault();
    router.history.back();
  };
  // A page-published title (dynamic routes) overrides the static route title,
  // same precedence as the desktop page head.
  const { title: publishedTitle } = usePageHeaderContent();
  const title =
    publishedTitle ??
    (meta && !isHome ? t(`pages.${meta.pageKey}.title`) : undefined);
  // Sticky page content (tab bars) sticks just below this bar.
  const measureRef = useHeightCssVar(MOBILE_TOP_BAR_HEIGHT_VAR);

  // The thread header (with its own back link) replaces this bar there.
  if (isImmersiveMobileRoute(pathname)) return null;

  return (
    <header
      ref={measureRef}
      className="sticky top-0 z-30 shrink-0 border-b bg-card pt-[env(safe-area-inset-top)] md:hidden"
    >
      <div className="flex h-14 items-center gap-1 pr-2 pl-1.5 max-sm:gap-0">
        {group ? (
          <Link
            href={group.href}
            onClick={goBack}
            aria-label={
              canGoBack
                ? t("mobile.backGeneric")
                : t("mobile.back", {
                    section: t(`groups.${group.key}.label`),
                  })
            }
            className={tapTarget}
          >
            <ChevronLeft className="size-[22px]" />
          </Link>
        ) : isHome ? (
          <Link
            href="/dashboard"
            aria-label="JigSwap"
            className="flex h-11 shrink-0 items-center gap-2 pl-1.5"
          >
            <Image src={logoMark} alt="" className="size-7 object-contain" />
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
                // The controls leave a phone about 126px: two smaller lines before an ellipsis.
                "font-heading truncate text-lg font-bold max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:text-base max-sm:leading-snug",
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
          href="/messages"
          aria-label={
            unreadMessages > 0
              ? t("mobile.withUnreadMessages", {
                  name: messagesTitle,
                  count: unreadMessages,
                })
              : messagesTitle
          }
          aria-current={pathname === "/messages" ? "page" : undefined}
          className={cn(tapTarget, "relative text-muted-foreground")}
        >
          <MessageSquare className="size-5" />
          {unreadMessages > 0 && (
            <span
              aria-hidden
              className="bg-jigsaw-primary-accent ring-card absolute top-1.5 right-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-white ring-2"
            >
              {unreadMessages > 9 ? "9+" : unreadMessages}
            </span>
          )}
        </Link>
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
        <span data-tour="account-menu" className="flex">
          <ShellUserButton tapTarget />
        </span>
      </div>
    </header>
  );
}
