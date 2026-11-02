"use client";

// Global top bar: the top arm of the sky L-frame, with no rule against the
// sidebar and NOT inside the white sheet. Sidebar toggle and logo, a flat search
// control centred on the window that opens the command palette, then bell, theme
// and language switchers and the frame's single marigold action, Add Puzzle. No
// user avatar here: user identity lives bottom-left in the sidebar. Desktop-only
// (md+): below the breakpoint the MobileTopBar replaces it.
import { Link } from "@/compat/link";
import { HeaderLogo } from "@/components/common/header-logo";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/ui/theme-toggle";
import { Plus, Search } from "lucide-react";
import { useTranslations } from "use-intl";

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const t = useTranslations("shell");

  return (
    // Equal outer columns keep the search centred on the window, not on the gap
    // between the two clusters; they grow past 1fr rather than clip at 820 wide.
    <header className="hidden h-12 shrink-0 grid-cols-[1fr_minmax(0,34rem)_1fr] items-center gap-4 px-2 md:grid">
      <div className="flex items-center gap-2 pl-2">
        <SidebarTrigger
          aria-label={t("toggleSidebar")}
          className="size-8 shrink-0 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent"
        />
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center rounded-md ring-sidebar-ring transition-opacity outline-none hover:opacity-80 focus-visible:ring-2"
        >
          <HeaderLogo />
        </Link>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-sidebar-border bg-background px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">
          {t("search.placeholder")}
        </span>
        <kbd className="pointer-events-none font-sans text-xs text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center justify-end gap-1">
        {/* Ghost hover is the frame's own tone, so these need the next sky step. */}
        <div className="flex items-center gap-1 [@media(hover:hover)]:[&_button:hover]:bg-sidebar-accent">
          <NotificationBell />
          <ModeToggle />
          <LanguageSwitcher />
        </div>
        <Button asChild variant="brand" size="sm" className="ml-1">
          <Link href="/my-puzzles/add" data-tour="my-puzzles-add">
            <Plus className="size-4" />
            <span>{t("actions.addPuzzle")}</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
