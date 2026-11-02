"use client";

// Global top bar of the console-style inset shell. It lives on the tinted
// chrome surface (NOT inside the white content card): sidebar toggle, brand,
// a centered search pill that opens the command palette, then bell, theme +
// language switchers (tucked on the right, desktop only) and the "Add to my
// puzzles" CTA. No user avatar here — user identity lives bottom-left in the sidebar.
// Desktop-only (md+): below the breakpoint the MobileTopBar replaces it. On a
// touch screen (a tablet at md+) every control is a 44px target. The pill is the
// middle of three columns, so it stays put whether or not a page shows the CTA,
// and the side columns only claim its room when their content needs it. Below lg
// the CTA's short label can outgrow its column, so the left column hugs the logo
// there: the pill keeps its left edge on every page and gives way on its right.
import { Link } from "@/compat/link";
import { HeaderLogo } from "@/components/common/header-logo";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/ui/theme-toggle";
import { useLocation } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useTranslations } from "use-intl";
import { hasOwnAddAction } from "./route-meta";
import { useShortcutHint } from "./shortcut-hint";

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const t = useTranslations("shell");
  const shortcut = useShortcutHint();
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <header className="hidden h-14 shrink-0 grid-cols-[1fr_minmax(0,520px)_1fr] items-center gap-x-3 px-4 max-lg:grid-cols-[auto_minmax(0,520px)_1fr] md:grid xl:gap-x-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="size-8 shrink-0 pointer-coarse:size-11" />
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center transition-opacity hover:opacity-80 pointer-coarse:h-11"
        >
          {/* A max-width in % would drop the logo out of its grid column's minimum width. */}
          <HeaderLogo className="h-7 max-w-none pl-0" />
        </Link>
      </div>

      {/* Centered pill search opening the command palette. */}
      <button
        type="button"
        onClick={onOpenPalette}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-9 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-full border bg-background px-4 text-sm text-muted-foreground shadow-xs transition-colors hover:border-ring/60 pointer-coarse:h-11"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">
          {t("search.placeholder")}
        </span>
        {/* The platform's own shortcut, known only after mount; touch screens have no keyboard
            to press it with. Muted text on the muted chip is only 4.34:1, so the hint uses the
            foreground colour. */}
        {shortcut && (
          <kbd className="pointer-events-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-foreground/75 pointer-coarse:hidden">
            {shortcut}
          </kbd>
        )}
      </button>

      <div className="flex items-center justify-end gap-1">
        <NotificationBell className="pointer-coarse:size-11" />
        <div className="flex items-center gap-1">
          <ModeToggle className="pointer-coarse:size-11" />
          <LanguageSwitcher className="pointer-coarse:size-11" />
        </div>
        {/* Named for where the puzzle ends up (the member's own puzzles), and left out where the
            page offers its own add actions, so two add buttons never sit side by side. */}
        {!hasOwnAddAction(pathname) && (
          <Button
            asChild
            className="ml-1 bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90 pointer-coarse:h-11 lg:max-xl:w-9 lg:max-xl:px-0 pointer-coarse:lg:max-xl:w-11"
          >
            <Link
              href="/my-puzzles/add"
              title={t("actions.addToMyPuzzles")}
              aria-label={t("actions.addToMyPuzzles")}
            >
              <Plus className="size-4" />
              {/* The full label would take the search pill's room below lg and its place from lg
                  to xl, so it shows from xl. Below that: a short label, then only the icon. */}
              <span className="lg:hidden">{t("actions.add")}</span>
              <span className="hidden max-xl:sr-only lg:inline">
                {t("actions.addToMyPuzzles")}
              </span>
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
