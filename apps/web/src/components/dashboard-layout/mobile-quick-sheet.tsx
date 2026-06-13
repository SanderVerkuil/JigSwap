"use client";

// Quick-action bottom sheet opened by the tab bar's raised center "+": the
// four most-used actions as 56px rows — violet round icon chip, title with a
// one-line sub, chevron — sliding up over the dimmed backdrop, with a drag
// handle and safe-area bottom padding.

import { useRouter } from "@/compat/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  ArrowLeftRight,
  ChevronRight,
  CircleCheck,
  type LucideIcon,
  Plus,
  Search,
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
];

export function MobileQuickSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shell");
  const router = useRouter();

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
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
                </span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
