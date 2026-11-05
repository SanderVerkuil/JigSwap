"use client";

// Slim sky top bar (replaces the desktop chrome below the md breakpoint):
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
// baked in underneath, which doubled the wordmark text beside it. 96px covers
// the 28px mark at 3x (assets/icon.png is the 256px source).
import logoMark from "@/components/marketing/assets/icon-96.webp";
import { formatUnreadBadge } from "@/components/notifications/unread-count";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Bell, ChevronLeft, MessageSquare, Search } from "lucide-react";
import { useCallback, useSyncExternalStore, type MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { formatNavBadge, nameForNavBadge } from "./nav-badge";
import { useUnreadMessageCount } from "./nav-counts";
import { usePageHeaderContent } from "./page-header-slot";
import {
  getNavGroup,
  isImmersiveMobileRoute,
  isMobileTabRoot,
} from "./route-meta";
import { useShellTitle } from "./shell-title";
import { ShellUserButton } from "./shell-user-button";
import { MOBILE_TOP_BAR_HEIGHT_VAR, useHeightCssVar } from "./sticky-offset";

// Shared 44px touch target for every control in the bar; the page's own control shows as current.
const tapTarget =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-[background-color,scale] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:active:scale-[0.97] aria-[current=page]:text-primary-text";

export function MobileTopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const t = useTranslations("shell");
  const tMobile = useTranslations("shell.mobile");
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
  // The dot shows no number, so the count lives in the link's name; capped like the desktop bell.
  const bellLabel =
    unread > 0
      ? tNotifications("bellWithCount", { count: formatUnreadBadge(unread) })
      : tNotifications("bell");

  // A page-published title (dynamic routes) overrides the static route title,
  // same precedence as the desktop page head.
  const { meta, title: shellTitle, titleOverride } = useShellTitle();
  const { mobileTitle } = usePageHeaderContent();
  const isHome = meta?.variant === "dashboard";
  // Deep pages (a route with a parent section or page) trade the breadcrumb row
  // for a back chevron; landings, the profile and the pages a tab opens (/trades
  // sits in Community but is the Swaps tab) show only a title.
  const group =
    meta?.group && meta.variant === undefined && !isMobileTabRoot(pathname)
      ? getNavGroup(meta.group)
      : undefined;
  const up = group
    ? { href: group.href, label: t(`groups.${group.key}.label`) }
    : meta?.parent
      ? {
          href: meta.parent.href,
          label: t(`pages.${meta.parent.pageKey}.title`),
        }
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
  // Home shows the brand lockup instead of a title (the greeting is the sr-only h1 in main).
  const title =
    mobileTitle ?? (isHome && titleOverride == null ? undefined : shellTitle);
  // Sticky page content (tab bars) sticks just below this bar.
  const measureRef = useHeightCssVar(MOBILE_TOP_BAR_HEIGHT_VAR);

  // The thread header (with its own back link) replaces this bar there.
  if (isImmersiveMobileRoute(pathname)) return null;

  return (
    <header
      ref={measureRef}
      className="sticky top-0 z-30 shrink-0 bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground md:hidden"
    >
      <div className="flex h-14 items-center gap-1 pr-2 pl-1.5 max-sm:gap-0">
        {up ? (
          <Link
            href={up.href}
            // On a child of that page the router would call this link the current page.
            activeOptions={{ exact: true }}
            onClick={goBack}
            aria-label={
              canGoBack
                ? t("mobile.backGeneric")
                : t("mobile.back", { section: up.label })
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
            {/* Decorative: the wordmark beside it already names the link. */}
            <Image
              src={logoMark}
              alt=""
              width={28}
              height={28}
              priority
              className="size-7 object-contain"
            />
            <span className="font-logo text-[22px] leading-none font-bold">
              <span className="text-logo-jig">Jig</span>
              <span className="text-logo-swap">Swap</span>
            </span>
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* Plain text: the page's h1 lives in main (ShellHeading), not in the banner. */}
          {title && (
            <p
              className={cn(
                // The controls leave a phone about 126px: two smaller lines before an ellipsis.
                "font-heading truncate text-xl leading-7 max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:text-base max-sm:leading-snug",
                !up && "pl-2",
              )}
            >
              {title}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={t("search.label")}
          className={tapTarget}
        >
          <Search className="size-5" />
        </button>
        <Link
          href="/messages"
          aria-label={
            unreadMessages > 0
              ? t("mobile.withUnreadMessages", {
                  name: nameForNavBadge(tMobile, messagesTitle, unreadMessages),
                  count: unreadMessages,
                })
              : messagesTitle
          }
          aria-current={pathname === "/messages" ? "page" : undefined}
          className={cn(tapTarget, "relative")}
        >
          <MessageSquare className="size-5" />
          {unreadMessages > 0 && (
            <span
              aria-hidden
              className="bg-jigsaw-primary-accent ring-card absolute top-1.5 right-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-white ring-2"
            >
              {formatNavBadge(unreadMessages)}
            </span>
          )}
        </Link>
        <Link
          href="/notifications"
          aria-label={bellLabel}
          aria-current={pathname === "/notifications" ? "page" : undefined}
          // Preferences isn't the notifications page, though it sits below it.
          activeOptions={{ exact: true }}
          className={cn(tapTarget, "relative")}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              aria-hidden
              className="bg-jigsaw-primary-accent ring-sidebar absolute top-2.5 right-2.5 size-2 rounded-full ring-2"
            />
          )}
        </Link>
        <span data-tour="account-menu" className="flex">
          <ShellUserButton tapTarget />
        </span>
      </div>
    </header>
  );
}
