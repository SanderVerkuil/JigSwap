"use client";

// Console-style inset shell (Google-Cloud-Console pattern): the tinted chrome
// surface fills the viewport and carries the global top bar and the
// transparent sidebar; the page content floats on it as a rounded, bordered,
// soft-shadowed card with the page head fixed at its top and the content
// scrolling inside it.
//
// Below the md breakpoint (the single mobile source of truth, = useIsMobile's
// 768px) that desktop chrome is CSS-swapped for a dedicated mobile shell: a
// slim safe-area-aware top bar and a bottom tab bar with a quick-action
// sheet; the content sits on the plain background with no inset card or page
// head. The shadcn sidebar's mobile offcanvas becomes unreachable by design —
// its trigger lives in the (hidden) desktop top bar. From md to 1024px the top
// bar's trigger opens that same sheet over the page, with the rail at rest.
import { MAIN_CONTENT_ID, SkipLink } from "@/components/a11y/skip-link";
import { InstallAppTip } from "@/components/install-app/install-app-tip";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WhatsNewAnnouncer } from "@/components/whats-new/announcer";
import { APP_SCROLL_REGION_ID } from "@/lib/scroll-restoration";
import {
  resolveSidebarOpen,
  SIDEBAR_WIDE_COOKIE_NAME,
  SIDEBAR_WIDE_QUERY,
  writeSidebarCookie,
  type SidebarCookies,
} from "@/lib/sidebar-state";
import { cn } from "@/lib/utils";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { contentWidthClass } from "./content-width";
import { MobileTabBar } from "./mobile-tab-bar";
import { MobileTopBar } from "./mobile-top-bar";
import { PageHead } from "./page-head";
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "./page-header-slot";
import { ShellPreferencesProvider, useShellPreferences } from "./preferences";
import { isFullBleedRoute, isImmersiveMobileRoute } from "./route-meta";
import { ShellDocumentTitle, ShellHeading } from "./shell-title";
import { SyncPreferredLanguage } from "./sync-preferred-language";
import { TopBar } from "./top-bar";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(SIDEBAR_WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getWideSnapshot = () => window.matchMedia(SIDEBAR_WIDE_QUERY).matches;

// The desktop sidebar's open state (UX-05, see lib/sidebar-state.ts): the icon rail below 1024px,
// where the toggle opens an overlay instead; from there the member's remembered toggle wins, else
// docked open. It follows the window live. The server and hydration render use last visit's width
// hint, so SSR paints the same sidebar the browser settles on.
function useSidebarOpen(cookies: SidebarCookies) {
  const [explicit, setExplicit] = useState(cookies.open);
  const wide = useSyncExternalStore(
    subscribeWide,
    getWideSnapshot,
    () => cookies.wide ?? true,
  );
  useEffect(() => {
    writeSidebarCookie(SIDEBAR_WIDE_COOKIE_NAME, wide);
  }, [wide]);
  return { open: resolveSidebarOpen(explicit, wide), setExplicit, wide };
}

const NO_SIDEBAR_COOKIES: SidebarCookies = { open: undefined, wide: undefined };

export function DashboardShell({
  children,
  sidebar = NO_SIDEBAR_COOKIES,
}: {
  children: React.ReactNode;
  /** The sidebar cookies, read by the route's beforeLoad (SSR-safe). */
  sidebar?: SidebarCookies;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sidebarState = useSidebarOpen(sidebar);
  const pathname = useLocation({ select: (location) => location.pathname });
  // Full-bleed pages (/messages) fill the card from md: no content padding and
  // no page scroll, so only the page's own panes scroll.
  const fullBleed = isFullBleedRoute(pathname);

  return (
    <ShellPreferencesProvider>
      <PageHeaderSlotProvider>
        <SyncPreferredLanguage />
        <ShellDocumentTitle />
        {/* Mobile scrolls the document itself (no height cap, no overflow clip
            below md) so the browser's address bar auto-hides on scroll-down and
            returns on scroll-up — the regular-website behaviour. The mobile top
            bar is sticky and the tab bar is position:fixed so both stay pinned
            while the page scrolls under them. Desktop keeps the inset-card model:
            a fixed `svh` column that clips its own overflow and scrolls inside
            the card. */}
        {/* Controlled: the provider still writes the sidebar_state cookie on every docked toggle. */}
        <SidebarProvider
          open={sidebarState.open}
          onOpenChange={sidebarState.setExplicit}
          overlay={!sidebarState.wide}
          overlayKey={pathname}
          className="flex-col md:h-svh md:overflow-hidden"
        >
          {/* First Tab stop: jumps past the top bar and sidebar to the main landmark. */}
          <SkipLink />
          <TopBar onOpenPalette={() => setPaletteOpen(true)} />
          <MobileTopBar onOpenPalette={() => setPaletteOpen(true)} />
          <div className="flex flex-1 md:min-h-0">
            <AppSidebar />
            <SidebarInset
              id={MAIN_CONTENT_ID}
              tabIndex={-1}
              className="md:min-h-0 md:overflow-hidden md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:mr-3 md:peer-data-[variant=inset]:mb-3 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0"
            >
              {/* ONE scroll region holds the page head + content, so content scrolls UNDER the
                  glass head (sticky top-0). Clipped to the card's rounded corners by SidebarInset's
                  overflow-hidden. */}
              {/* --app-sticky-top: where sticky page content (tab bars) sticks — below the mobile
                  top bar on phones, below the page head from md (see sticky-offset.ts). Phones
                  clip rather than hide x-overflow: `hidden` would make this a scroll container
                  that never scrolls (the document does), and sticky children would never stick. */}
              <div
                data-scroll-restoration-id={APP_SCROLL_REGION_ID}
                className={cn(
                  "flex-1 overflow-x-clip [--app-sticky-top:var(--mobile-top-bar-height,0px)] md:min-h-0 md:overflow-x-hidden md:overflow-y-auto md:[--app-sticky-top:var(--page-head-height,0px)]",
                  // Full-bleed: a column whose content area takes the rest of the card. It only
                  // scrolls (with no reserved gutter) when the window is shorter than the page's
                  // minimum height, so the composer is never clipped out of reach.
                  fullBleed
                    ? "md:flex md:flex-col"
                    : "md:[scrollbar-gutter:stable]",
                )}
              >
                <PageHead />
                <ContentArea fullBleed={fullBleed}>{children}</ContentArea>
              </div>
            </SidebarInset>
          </div>
          {/* Mobile-only, sticks just above the tab bar. */}
          <InstallAppTip />
          <MobileTabBar />
          <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
          <WhatsNewAnnouncer />
        </SidebarProvider>
      </PageHeaderSlotProvider>
    </ShellPreferencesProvider>
  );
}

// Mobile-only row carrying the page's registered header actions; the desktop
// page head is hidden below md, so without this the primary action (New Goal,
// Create Circle…) would be unreachable on phones. The row wraps: overflow in a
// right-aligned row would run off the left edge, where it can't be scrolled to.
// The page's meta line stays in the desktop head only.
export function MobilePageActions() {
  const { actions } = usePageHeaderContent();
  const pathname = useLocation({ select: (location) => location.pathname });
  // An immersive route (an open thread) owns the whole phone screen.
  if (!actions || isImmersiveMobileRoute(pathname)) return null;
  return (
    <div
      data-slot="mobile-page-actions"
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 md:hidden",
        // The inbox list pads its own rows, so on /messages New sits tight above it.
        isFullBleedRoute(pathname) ? "-mt-2" : "mb-4",
      )}
    >
      {actions}
    </div>
  );
}

// The padded content region inside the shared scroll container (the scroll lives one level up so
// content passes under the sticky glass head). Honours the content-width preference (full width by
// default, or a ~1180px centered column).
function ContentArea({
  children,
  fullBleed,
}: {
  children: React.ReactNode;
  fullBleed: boolean;
}) {
  const { fullWidth } = useShellPreferences();

  return (
    <div
      className={cn(
        // Mobile: 18px top / 16px sides per the mobile spec. The sticky tab bar
        // occupies its own layout space below this scroll content, so we only
        // need a little bottom breathing room so the last item clears the raised
        // center button's overhang.
        "w-full px-4 pt-[18px] pb-6 md:p-6",
        contentWidthClass(fullWidth),
        // Edge to edge whatever the width preference, filling the card's height.
        fullBleed && "md:flex md:min-h-0 md:max-w-none md:flex-1 md:p-0",
      )}
    >
      {/* The page's h1 on phones, where the page head is hidden. */}
      <ShellHeading />
      <MobilePageActions />
      {children}
    </div>
  );
}
