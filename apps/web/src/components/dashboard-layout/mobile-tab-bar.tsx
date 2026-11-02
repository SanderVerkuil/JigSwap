"use client";

// Mobile bottom tab bar: the four destinations that matter (Home, Library,
// Swaps, Community) around a raised center "+" that opens the quick-action
// sheet. The tab highlight derives from the current route's parent section —
// library pages light Library, community pages light Community — except
// /trades, which lights its dedicated Swaps tab. Safe-area padded for
// home-indicator phones only in the installed app (see the nav's comment).
// Swaps carries a badge for requests waiting for the member's answer and
// Community a dot for unread messages; each count is part of the tab's name.
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { UnreadDot } from "@/components/whats-new/badges";
import { useWhatsNewUnreadCount } from "@/components/whats-new/use-whats-new-state";
import { scrollToTopIfCurrent } from "@/lib/scroll-restoration";
import { cn } from "@/lib/utils";
import { useRouter } from "@tanstack/react-router";
import { Plus, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { MobileQuickSheet } from "./mobile-quick-sheet";
import { usePendingRequestCount, useUnreadMessageCount } from "./nav-counts";
import {
  getRouteMeta,
  isImmersiveMobileRoute,
  MOBILE_TABS,
  type MobileTabKey,
} from "./route-meta";
import { MOBILE_TAB_BAR_HEIGHT_VAR, useHeightCssVar } from "./sticky-offset";

// /trades lights Swaps; every other route lights its parent section's tab.
function activeTab(pathname: string): MobileTabKey | null {
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
  // No room for a fifth tab: What's new lives in the quick sheet, flagged by a dot on the "+".
  const whatsNewCount = useWhatsNewUnreadCount();

  // Incoming swap requests still awaiting an answer (Swaps badge) and unread
  // messages (Community dot, quick-sheet row): Messages lives under Community.
  const pending = usePendingRequestCount();
  const unreadMessages = useUnreadMessageCount();
  const counts: Partial<Record<MobileTabKey, TabCount>> = {
    swaps: {
      value: pending,
      indicator: "badge",
      label: t("withPendingRequests", {
        name: t("tabs.swaps"),
        count: pending,
      }),
    },
    community: {
      value: unreadMessages,
      indicator: "dot",
      label: t("withUnreadMessages", {
        name: t("tabs.community"),
        count: unreadMessages,
      }),
    },
  };
  // Toasts, the install tip and the quick-start footer dock above this bar.
  const measureRef = useHeightCssVar(MOBILE_TAB_BAR_HEIGHT_VAR);

  // The open thread / new-conversation pane owns the phone screen (composer above the keyboard).
  if (isImmersiveMobileRoute(pathname)) return null;

  return (
    <>
      <nav
        ref={measureRef}
        aria-label={t("tabsLabel")}
        // position:sticky (not fixed) — it's the last flex child of the shell
        // column with the content row (flex-1) above it, so it lands at the
        // viewport bottom whether content is short (flex pushes it down) or tall
        // (it sticks at bottom:0 while the document scrolls under it). Sticky is
        // painted with the scroll content and tracks the *visual* viewport, so
        // it scrolls smoothly and stays flush as the address bar shows/hides —
        // unlike fixed, which the browser re-snaps to the layout viewport after
        // the toolbar animation (the jitter + the gap when the address bar
        // appears). No env(safe-area-inset-bottom) pad in a browser tab: the
        // mobile browser's bottom chrome already clears the home indicator, and
        // on this target it reports a non-zero inset even with the address bar
        // up, which showed as a standing gap below the bar. The installed app
        // (display-mode: standalone, viewport-fit=cover) has no browser chrome,
        // so there the bar does pad the inset or the home indicator would sit
        // on the tab row. z-30 + overflow-visible keep the raised
        // center button (which rises above the bar via -mt) painted above page
        // content and unclipped.
        //
        // shadow: a solid same-colour "skirt" painted 24px BELOW the bar. Over a
        // body-scrolling page the browser repaints a sticky/fixed bottom bar a
        // frame behind the scroll, so during a fling the bar trails and a sliver
        // of content peeks out below it. A box-shadow never affects layout or
        // scroll height, so this fills that transient gap (and any iOS
        // rubber-band overscroll) without adding a scrollable strip.
        //
        // will-change-transform: promote the bar to its own compositor layer so
        // the engine keeps it glued during async scroll / the dynamic-toolbar
        // transition. Helps the gap most on Firefox for Android, whose Gecko
        // compositor otherwise lets a sticky bottom bar trail/detach more than
        // Blink does.
        className="sticky bottom-0 z-30 grid shrink-0 grid-cols-5 items-stretch overflow-visible border-t bg-card shadow-[0_24px_0_0_var(--card)] [will-change:transform] md:hidden [@media(display-mode:standalone)]:pb-[env(safe-area-inset-bottom)]"
      >
        {MOBILE_TABS.slice(0, 2).map((tab) => (
          <TabLink key={tab.key} tab={tab} active={active} />
        ))}
        {/* The raised "+" reaches 12px above the bar; toasts clear it (sticky-offset.ts
            MOBILE_TAB_BAR_RAISE). */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={
              whatsNewCount > 0
                ? t("openQuickActionsUnread", { count: whatsNewCount })
                : t("openQuickActions")
            }
            className="bg-jigsaw-primary ring-card relative -mt-[22px] inline-flex size-[52px] items-center justify-center rounded-full text-white shadow-[0_8px_22px_-6px_color-mix(in_oklab,var(--jigsaw-primary)_65%,transparent)] ring-4"
          >
            <Plus className="size-6" />
            {whatsNewCount > 0 && (
              <UnreadDot className="ring-card top-0.5 right-0.5 size-2.5" />
            )}
          </button>
        </div>
        {MOBILE_TABS.slice(2).map((tab) => (
          <TabLink
            key={tab.key}
            tab={tab}
            active={active}
            count={counts[tab.key]}
          />
        ))}
      </nav>
      <MobileQuickSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        whatsNewCount={whatsNewCount}
        unreadMessages={unreadMessages}
      />
    </>
  );
}

// A tab's live count: shown as a capped badge or a plain dot, both aria-hidden;
// while it is above 0, `label` (the tab's name with the full count) names the tab.
type TabCount = {
  value: number;
  indicator: "badge" | "dot";
  label: string;
};

function TabLink({
  tab,
  active,
  count,
}: {
  tab: { key: MobileTabKey; href: string; icon: LucideIcon };
  active: MobileTabKey | null;
  count?: TabCount;
}) {
  const t = useTranslations("shell.mobile");
  const router = useRouter();
  const on = active === tab.key;
  const value = count?.value ?? 0;

  return (
    <Link
      href={tab.href}
      onClick={(event) =>
        scrollToTopIfCurrent(event, router.latestLocation.href, tab.href)
      }
      aria-label={count && value > 0 ? count.label : t(`tabs.${tab.key}`)}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center",
        on ? "text-jigsaw-primary" : "text-muted-foreground",
      )}
    >
      <span className="relative">
        <tab.icon className="size-[21px]" />
        {value > 0 &&
          (count?.indicator === "dot" ? (
            <UnreadDot className="ring-card -top-0.5 -right-1 size-2.5" />
          ) : (
            <span
              aria-hidden
              className="bg-jigsaw-primary-accent absolute -top-1 -right-2 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-white"
            >
              {value > 9 ? "9+" : value}
            </span>
          ))}
      </span>
    </Link>
  );
}
