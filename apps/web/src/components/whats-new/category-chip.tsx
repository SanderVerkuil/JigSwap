import { cn } from "@/lib/utils";
import type { WhatsNewCategory } from "@jigswap/contracts";
import { Rocket, TrendingUp, Wrench, type LucideIcon } from "lucide-react";
import { useTranslations } from "use-intl";

// One record for the category look (spec Part B §1.4; contrast measured against --card in both
// themes), reused by the page, the modal and (W3) the notification accent.
export const CATEGORY_META: Record<
  WhatsNewCategory,
  { icon: LucideIcon; className: string }
> = {
  feature: {
    icon: Rocket,
    className:
      "bg-jigsaw-primary/10 text-jigsaw-primary dark:bg-jigsaw-primary/20 dark:text-violet-300",
  },
  improvement: {
    icon: TrendingUp,
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  },
  // amber-800, not the amber-700 used elsewhere: amber-700 on amber-500/15 is 4.49:1 at 12px.
  fix: {
    icon: Wrench,
    className: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
  },
};

// A label, not a filter: no interaction.
export function CategoryChip({ category }: { category: WhatsNewCategory }) {
  const t = useTranslations("whatsNew.category");
  const meta = CATEGORY_META[category];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold [&>svg]:size-3",
        meta.className,
      )}
    >
      <meta.icon aria-hidden />
      {t(category)}
    </span>
  );
}

// The unread count pill colours (spec Part B §2): plain bg-primary in dark mode is only 3.8:1.
export const COUNT_PILL_COLORS =
  "bg-primary text-primary-foreground dark:bg-violet-300 dark:text-background";
