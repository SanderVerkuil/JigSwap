"use client";

// Global top bar: the top arm of the sky L-frame, with no rule against the
// sidebar and NOT inside the white sheet. Sidebar toggle and logo, a flat search
// control centred on the window that opens the command palette, then bell, theme
// and language switchers and the frame's single marigold action, "Add to my
// puzzles". No user avatar here: user identity lives bottom-left in the sidebar.
// Desktop-only (md+): below the breakpoint the MobileTopBar replaces it. On a
// touch screen (a tablet at md+) every control is a 44px target.
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
    // Equal outer columns keep the search centred on the window, not on the gap between the two
    // clusters, whether or not a page shows the CTA. Below lg the CTA's short label can outgrow its
    // column, so the left column hugs the logo there: the search keeps its left edge on every page
    // and gives way on its right.
    <header className="hidden h-12 shrink-0 grid-cols-[1fr_minmax(0,34rem)_1fr] items-center gap-x-3 px-2 max-lg:grid-cols-[auto_minmax(0,34rem)_1fr] md:grid xl:gap-x-6">
      <div className="flex items-center gap-2 pl-2">
        <SidebarTrigger
          aria-label={t("toggleSidebar")}
          className="size-8 shrink-0 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent pointer-coarse:size-11"
        />
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center rounded-md ring-sidebar-ring transition-opacity outline-none hover:opacity-80 focus-visible:ring-2 pointer-coarse:h-11"
        >
          <HeaderLogo />
        </Link>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-sidebar-border bg-background px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">
          {t("search.placeholder")}
        </span>
        {/* The platform's own shortcut, known only after mount; touch screens have no keyboard
            to press it with. */}
        {shortcut && (
          <kbd className="pointer-events-none font-sans text-xs text-foreground/75 pointer-coarse:hidden">
            {shortcut}
          </kbd>
        )}
      </button>

      <div className="flex items-center justify-end gap-1">
        {/* Ghost hover is the frame's own tone, so these need the next sky step. */}
        <div className="flex items-center gap-1 [@media(hover:hover)]:[&_button:hover]:bg-sidebar-accent">
          <NotificationBell className="pointer-coarse:size-11" />
          <ModeToggle className="pointer-coarse:size-11" />
          <LanguageSwitcher className="pointer-coarse:size-11" />
        </div>
        {/* Named for where the puzzle ends up (the member's own puzzles), and left out where the
            page offers its own add actions, so two add buttons never sit side by side. */}
        {!hasOwnAddAction(pathname) && (
          <Button
            asChild
            variant="brand"
            size="sm"
            className="ml-1 pointer-coarse:h-11 lg:max-xl:w-8 lg:max-xl:px-0 pointer-coarse:lg:max-xl:w-11"
          >
            <Link
              href="/my-puzzles/add"
              title={t("actions.addToMyPuzzles")}
              aria-label={t("actions.addToMyPuzzles")}
            >
              <Plus className="size-4" />
              {/* The full label would take the search's room below lg and its place from lg
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
