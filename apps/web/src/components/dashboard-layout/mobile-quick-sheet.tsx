"use client";

// Quick-action bottom sheet opened by the tab bar's raised center "+": the
// most-used actions as a flat list of 56px rows (bare icon, title, one-line
// sub) sliding up over the dimmed backdrop, with a title row holding the close
// button and safe-area bottom padding. Below the actions, the theme and language
// choices: phones have no top-bar menus for them.
import {
  requestInstallTip,
  runInstallPrompt,
  useInstallMethod,
} from "@/components/install-app/use-install-app";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { WhatsNewCountPill } from "@/components/whats-new/badges";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  CircleCheck,
  CircleHelp,
  Download,
  FileText,
  MessageSquare,
  Plus,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "use-intl";
import { LanguageRadios, ThemeRadios } from "./display-preferences";

const ROW =
  "hover:bg-accent active:bg-accent focus-visible:ring-ring flex min-h-14 w-full items-center gap-3.5 rounded-lg px-2.5 py-2 text-left transition-[background-color,scale] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] outline-none focus-visible:ring-2 motion-safe:active:scale-[0.97]";
const ROW_ICON = "text-primary-text size-5 shrink-0";

// Titles reuse the command palette's quick-action strings where they exist;
// the subs (and Find a swap) live under shell.mobile.quick. Every row opens what
// it promises: the log flow rather than the completions list, and Browse (where
// a swap starts) rather than the exchanges list.
const ACTIONS: Array<{
  titleKey: string;
  subKey: string;
  href: string;
  icon: LucideIcon;
}> = [
  {
    titleKey: "actions.addAPuzzle",
    subKey: "mobile.quick.addPuzzleSub",
    href: "/my-puzzles/add",
    icon: Plus,
  },
  {
    titleKey: "actions.logCompletion",
    subKey: "mobile.quick.logCompletionSub",
    href: "/completions/new",
    icon: CircleCheck,
  },
  {
    titleKey: "mobile.quick.findSwap",
    subKey: "mobile.quick.findSwapSub",
    href: "/browse",
    icon: ArrowLeftRight,
  },
  // Messages has no tab of its own: this row (and the top-bar icon) carries the unread count.
  {
    titleKey: "pages.messages.title",
    subKey: "pages.messages.description",
    href: "/messages",
    icon: MessageSquare,
  },
  // A clear, labelled route to the member's own profile (the top-bar avatar
  // also links here, but it's an unlabelled icon). Reuses the existing
  // shell.pages.profile strings — no new translations.
  {
    titleKey: "pages.profile.title",
    subKey: "pages.profile.subtitle",
    href: "/profile",
    icon: UserRound,
  },
  // What's new has no tab of its own on mobile; this row carries its unread count.
  {
    titleKey: "pages.whatsNew.title",
    subKey: "mobile.quick.whatsNewSub",
    href: "/whats-new",
    icon: Sparkles,
  },
  // The tours, one tap from any page (UX-91): the Guides tab of What's new. Same label as the
  // account menu's item.
  {
    titleKey: "user.helpGuides",
    subKey: "mobile.quick.helpGuidesSub",
    href: "/whats-new?tab=guides",
    icon: CircleHelp,
  },
  // The written guides at /docs, under the tours. Same label as the account menu's item.
  {
    titleKey: "user.docs",
    subKey: "mobile.quick.docsSub",
    href: "/docs",
    icon: FileText,
  },
];

export function MobileQuickSheet({
  open,
  onOpenChange,
  whatsNewCount,
  unreadMessages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whatsNewCount: number;
  unreadMessages: number;
}) {
  const t = useTranslations("shell");
  const tWhatsNew = useTranslations("whatsNew");
  const tMessages = useTranslations("messages");
  const tInstall = useTranslations("installApp");
  const tTheme = useTranslations("shell.theme");
  const tLanguage = useTranslations("shell.language");
  const navigate = useNavigate();
  const countFor = (href: string) =>
    href === "/whats-new"
      ? whatsNewCount
      : href === "/messages"
        ? unreadMessages
        : 0;
  const countLabel = (href: string, count: number) =>
    href === "/messages"
      ? tMessages("unreadCount", { count })
      : tWhatsNew("unreadCount", { count });

  // `href`, not `to`: the router parses its query (?tab=guides), which `to` would keep in the path.
  const go = (href: string) => {
    onOpenChange(false);
    void navigate({ href });
  };

  // The persistent install entry (the tip itself can be snoozed or turned off): the browser's
  // install dialog where Chromium offers one, else the tip's manual steps (iOS Share, or the
  // Chrome / Firefox menu on Android).
  const installMethod = useInstallMethod();
  const install = () => {
    onOpenChange(false);
    if (installMethod === "prompt") void runInstallPrompt("menu");
    else requestInstallTip();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        // On short phones the sheet scrolls rather than running off the top, keeping a strip of the
        // dimmed page in view. The slide takes the iOS drawer curve; SheetContent itself drops it
        // under reduced motion.
        className="max-h-[calc(100dvh-3rem)] gap-0 overflow-y-auto overscroll-contain rounded-t-xl border-t-0 bg-card p-0 ease-[cubic-bezier(0.32,0.72,0,1)]"
      >
        {/* Beside the sheet's close button, which screen-reader and switch users need: they can't
            reach the dimmed backdrop. */}
        <SheetTitle className="flex min-h-12 items-center pr-12 pl-6 text-sm font-semibold">
          {t("search.quickActions")}
        </SheetTitle>
        <div className="px-3.5 pb-[calc(18px+env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-0.5">
            {ACTIONS.map((action) => (
              <button
                key={action.href}
                type="button"
                onClick={() => go(action.href)}
                className={ROW}
              >
                <action.icon aria-hidden className={ROW_ICON} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {t(action.titleKey)}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {t(action.subKey)}
                  </span>
                  {countFor(action.href) > 0 && (
                    <span className="sr-only">
                      {countLabel(action.href, countFor(action.href))}
                    </span>
                  )}
                </span>
                <WhatsNewCountPill count={countFor(action.href)} />
              </button>
            ))}
            {installMethod && (
              <button type="button" onClick={install} className={ROW}>
                <Download aria-hidden className={ROW_ICON} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {tInstall("menuTitle")}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {tInstall("menuSub")}
                  </span>
                </span>
              </button>
            )}
          </div>
          <div className="mx-2.5 mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t pt-3">
            <span className="text-sm font-medium">{tTheme("label")}</span>
            <ThemeRadios />
            <span className="text-sm font-medium">{tLanguage("label")}</span>
            <LanguageRadios />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
