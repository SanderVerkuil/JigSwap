"use client";

// Global top bar of the console-style inset shell. It lives on the tinted
// chrome surface (NOT inside the white content card): sidebar toggle, brand,
// a centered search pill that opens the command palette, then bell, theme +
// language switchers (tucked on the right, desktop only) and the Add Puzzle
// CTA. No user avatar here — user identity lives bottom-left in the sidebar.

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
    <header className="flex h-14 shrink-0 items-center gap-1.5 px-3 md:gap-2 md:px-4">
      <SidebarTrigger className="size-8 shrink-0" />
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center transition-opacity hover:opacity-80"
      >
        <HeaderLogo className="h-7 pl-0" />
      </Link>

      {/* Centered pill search — collapses to an icon button on mobile. */}
      <div className="flex min-w-0 flex-1 justify-center px-2 md:px-6">
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden h-9 w-full max-w-[520px] cursor-pointer items-center gap-2.5 rounded-full border bg-background px-4 text-sm text-muted-foreground shadow-xs transition-colors hover:border-ring/60 md:flex"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">
            {t("search.placeholder")}
          </span>
          <kbd className="pointer-events-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onOpenPalette}
          aria-label={t("search.label")}
        >
          <Search className="size-5" />
        </Button>
        <NotificationBell />
        <div className="hidden items-center gap-1 md:flex">
          <ModeToggle />
          <LanguageSwitcher />
        </div>
        <Button
          asChild
          className="ml-1 bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90"
        >
          <Link href="/my-puzzles/add">
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("actions.addPuzzle")}</span>
            <span className="sr-only sm:hidden">{t("actions.addPuzzle")}</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
