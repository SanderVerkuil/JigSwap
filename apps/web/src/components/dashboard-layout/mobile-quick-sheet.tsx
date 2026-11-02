"use client";

// Quick-action bottom sheet opened by the tab bar's raised center "+": the
// most-used actions as a flat list of 56px rows (bare icon, title, one-line
// sub) sliding up over the dimmed backdrop, with a drag handle and safe-area
// bottom padding.
import { useRouter } from "@/compat/navigation";
import {
  requestInstallTip,
  runInstallPrompt,
  useInstallMethod,
} from "@/components/install-app/use-install-app";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { WhatsNewCountPill } from "@/components/whats-new/badges";
import {
  ArrowLeftRight,
  CircleCheck,
  Download,
  Plus,
  Search,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "use-intl";

const ROW =
  "hover:bg-accent active:bg-accent focus-visible:ring-ring/50 flex min-h-14 w-full items-center gap-3.5 rounded-lg px-2.5 py-2 text-left transition-[background-color,scale] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] outline-none focus-visible:ring-[3px] motion-safe:active:scale-[0.97]";
const ROW_ICON = "text-primary-text size-5 shrink-0";

// Titles reuse the command palette's quick-action strings where they exist;
// the subs (and Propose a Swap) live under shell.mobile.quick.
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
    href: "/completions",
    icon: CircleCheck,
  },
  {
    titleKey: "mobile.quick.proposeSwap",
    subKey: "mobile.quick.proposeSwapSub",
    href: "/trades",
    icon: ArrowLeftRight,
  },
  {
    titleKey: "actions.browseCommunity",
    subKey: "mobile.quick.browseCommunitySub",
    href: "/browse",
    icon: Search,
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
];

export function MobileQuickSheet({
  open,
  onOpenChange,
  whatsNewCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whatsNewCount: number;
}) {
  const t = useTranslations("shell");
  const tWhatsNew = useTranslations("whatsNew");
  const tInstall = useTranslations("installApp");
  const router = useRouter();
  const countFor = (href: string) =>
    href === "/whats-new" ? whatsNewCount : 0;

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
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
        // The drag handle replaces the default X close affordance (the only
        // direct child <button> of the content is that close button). The slide
        // takes the iOS drawer curve; SheetContent itself drops it under reduced motion.
        className="gap-0 rounded-t-xl border-t-0 bg-card p-0 ease-[cubic-bezier(0.32,0.72,0,1)] [&>button]:hidden"
      >
        <SheetTitle className="sr-only">{t("search.quickActions")}</SheetTitle>
        <div className="px-3.5 pt-2.5 pb-[calc(18px+env(safe-area-inset-bottom))]">
          <div className="bg-border mx-auto mb-3 h-1 w-10 rounded-full" />
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
                  <span className="block font-medium">
                    {t(action.titleKey)}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {t(action.subKey)}
                  </span>
                  {countFor(action.href) > 0 && (
                    <span className="sr-only">
                      {tWhatsNew("unreadCount", {
                        count: countFor(action.href),
                      })}
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
                  <span className="block font-medium">
                    {tInstall("menuTitle")}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {tInstall("menuSub")}
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
