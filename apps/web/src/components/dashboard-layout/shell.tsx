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
// its trigger lives in the (hidden) desktop top bar.

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { MobileTabBar } from "./mobile-tab-bar";
import { MobileTopBar } from "./mobile-top-bar";
import { PageHead } from "./page-head";
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "./page-header-slot";
import { ShellPreferencesProvider, useShellPreferences } from "./preferences";
import { TopBar } from "./top-bar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <ShellPreferencesProvider>
      <PageHeaderSlotProvider>
        {/* The shell is a fixed-height flex column that owns its own scroll.
            On mobile `100dvh` tracks the browser's dynamic toolbar (and, via
            interactive-widget=resizes-content, the on-screen keyboard) so the
            bottom tab bar — an in-flow flex child, not position:fixed — rides
            the viewport without the lag/repositioning jank fixed elements get
            during the address-bar show/hide animation. overflow-hidden keeps
            the document itself from scrolling, so env(safe-area-inset-bottom)
            stops toggling as the address bar appears/disappears. Desktop keeps
            `svh` (no dynamic toolbar, so svh == dvh there). */}
        <SidebarProvider className="flex-col h-[100dvh] overflow-hidden md:h-svh">
          <TopBar onOpenPalette={() => setPaletteOpen(true)} />
          <MobileTopBar onOpenPalette={() => setPaletteOpen(true)} />
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            <SidebarInset className="min-h-0 overflow-hidden md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:mr-3 md:peer-data-[variant=inset]:mb-3 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0">
              {/* ONE scroll region holds the page head + content, so content scrolls UNDER the
                  glass head (sticky top-0). Clipped to the card's rounded corners by SidebarInset's
                  overflow-hidden. */}
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto md:[scrollbar-gutter:stable]">
                <PageHead />
                <ContentArea>{children}</ContentArea>
              </div>
            </SidebarInset>
          </div>
          <MobileTabBar />
          <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
        </SidebarProvider>
      </PageHeaderSlotProvider>
    </ShellPreferencesProvider>
  );
}

// Mobile-only row carrying the page's registered header actions; the desktop
// page head is hidden below md, so without this the primary action (New Goal,
// Create Circle…) would be unreachable on phones.
function MobilePageActions() {
  const { actions } = usePageHeaderContent();
  if (!actions) return null;
  return (
    <div className="mb-4 flex items-center justify-end gap-2 md:hidden">
      {actions}
    </div>
  );
}

// The padded content region inside the shared scroll container (the scroll lives one level up so
// content passes under the sticky glass head). Honours the content-width preference (full width by
// default, or a ~1180px centered column).
function ContentArea({ children }: { children: React.ReactNode }) {
  const { fullWidth } = useShellPreferences();

  return (
    <div
      className={cn(
        // Mobile: 18px top / 16px sides per the mobile spec. The tab bar is an
        // in-flow flex sibling below this scroll region now, so content no
        // longer reserves space for it (or for the safe-area inset, which the
        // bar carries) — just a little bottom breathing room under the raised
        // center button.
        "w-full px-4 pt-[18px] pb-6 md:p-6",
        !fullWidth && "mx-auto max-w-[1180px]",
      )}
    >
      <MobilePageActions />
      {children}
    </div>
  );
}
