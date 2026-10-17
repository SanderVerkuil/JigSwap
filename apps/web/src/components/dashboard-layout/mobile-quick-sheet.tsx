"use client";

// Quick-action bottom sheet opened by the tab bar's raised center "+": the
// four most-used actions as 56px rows — violet round icon chip, title with a
// one-line sub, chevron — sliding up over the dimmed backdrop, with a drag
// handle and safe-area bottom padding.
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
  ChevronRight,
  CircleCheck,
  Download,
  Plus,
  Search,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "use-intl";

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
  // install dialog where Chromium offers one, else the tip's iOS Share steps.
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
        // direct child <button> of the content is that close button).
        className="gap-0 rounded-t-[20px] border-t-0 bg-card p-0 [&>button]:hidden"
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
                className="hover:bg-accent flex min-h-14 items-center gap-3.5 rounded-xl px-2.5 py-2 text-left transition-colors"
              >
                <span className="bg-jigsaw-primary/10 text-jigsaw-primary inline-flex size-[42px] shrink-0 items-center justify-center rounded-full">
                  <action.icon className="size-[19px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
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
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </button>
            ))}
            {installMethod && (
              <button
                type="button"
                onClick={install}
                className="hover:bg-accent flex min-h-14 items-center gap-3.5 rounded-xl px-2.5 py-2 text-left transition-colors"
              >
                <span className="bg-jigsaw-primary/10 text-jigsaw-primary inline-flex size-[42px] shrink-0 items-center justify-center rounded-full">
                  <Download className="size-[19px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {tInstall("menuTitle")}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {tInstall("menuSub")}
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
