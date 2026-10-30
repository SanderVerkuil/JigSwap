// Small status chips shared by the exchange row and its expanded detail.
import { cn } from "@/lib/utils";
import { useTranslations } from "use-intl";

const CHIP =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap";

/** The partner has confirmed completion; the viewer's confirmation settles the exchange. */
export function YourTurnPill({ className }: { className?: string }) {
  const t = useTranslations("trades.confirmation");
  return (
    <span
      className={cn(
        CHIP,
        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      {t("yourTurn")}
    </span>
  );
}
