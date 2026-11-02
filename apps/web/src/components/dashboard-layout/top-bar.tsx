"use client";

// Global top bar of the console-style inset shell. It lives on the tinted
// chrome surface (NOT inside the white content card): sidebar toggle, brand,
// a centered search pill that opens the command palette, then bell, theme +
// language switchers (tucked on the right, desktop only) and the Add Puzzle
// CTA. No user avatar here — user identity lives bottom-left in the sidebar.
// Desktop-only (md+): below the breakpoint the MobileTopBar replaces it. On a
// touch screen (a tablet at md+) every control is a 44px target.
import { Link } from "@/compat/link";
import { HeaderLogo } from "@/components/common/header-logo";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/ui/theme-toggle";
import { Plus, Search } from "lucide-react";
import { useTranslations } from "use-intl";
import { useShortcutHint } from "./shortcut-hint";

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const t = useTranslations("shell");
  const shortcut = useShortcutHint();

  return (
    <header className="hidden h-14 shrink-0 items-center gap-2 px-4 md:flex">
      <SidebarTrigger className="size-8 shrink-0 pointer-coarse:size-11" />
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center transition-opacity hover:opacity-80 pointer-coarse:h-11"
      >
        <HeaderLogo className="h-7 pl-0" />
      </Link>

      {/* Centered pill search opening the command palette. */}
      <div className="flex min-w-0 flex-1 justify-center px-6">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-9 w-full max-w-[520px] cursor-pointer items-center gap-2.5 rounded-full border bg-background px-4 text-sm text-muted-foreground shadow-xs transition-colors hover:border-ring/60 pointer-coarse:h-11"
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
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <NotificationBell className="pointer-coarse:size-11" />
        <div className="flex items-center gap-1">
          <ModeToggle className="pointer-coarse:size-11" />
          <LanguageSwitcher className="pointer-coarse:size-11" />
        </div>
        <Button
          asChild
          className="ml-1 bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90 pointer-coarse:h-11"
        >
          <Link href="/my-puzzles/add">
            <Plus className="size-4" />
            <span>{t("actions.addPuzzle")}</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
