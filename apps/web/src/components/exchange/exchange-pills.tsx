// Small status chips shared by the exchange row and its expanded detail, and the loan rows.
import { RELATIVE_TIME_UPDATE_INTERVAL_MS } from "@/hooks/use-relative-time";
import { cn } from "@/lib/utils";
import type { ExchangeFields } from "@jigswap/contracts";
import { CalendarClock, Tag } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "use-intl";
import type { Direction } from "./exchange-state";
import { calendarDaysUntil } from "./loan-due";

type SalePrice = NonNullable<ExchangeFields["salePrice"]>;

const CHIP =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap";

/** The partner has confirmed completion; the viewer's confirmation settles the exchange. */
export function YourTurnPill({ className }: { className?: string }) {
  const t = useTranslations("trades.confirmation");
  return (
    <span
      className={cn(
        CHIP,
        // amber-800 keeps 12px bold text above 4.5:1 on the tinted chip in light mode.
        "bg-amber-500/15 text-amber-800 dark:text-amber-400",
        className,
      )}
    >
      {t("yourTurn")}
    </span>
  );
}

// A sale's price is stored in minor units (cents) with its currency.
function useFormatPrice(): (price: SalePrice) => string {
  const format = useFormatter();
  return (price) =>
    format.number(price.amount / 100, {
      style: "currency",
      currency: price.currency,
    });
}

/** The buyer's offered price on a sale, as a chip on the exchange row. */
export function OfferChip({
  price,
  className,
}: {
  price: SalePrice;
  className?: string;
}) {
  const t = useTranslations("trades.offer");
  const formatPrice = useFormatPrice();
  return (
    <span className={cn(CHIP, "bg-muted text-foreground", className)}>
      {t("chip", { price: formatPrice(price) })}
    </span>
  );
}

/** The offered price in the expanded detail, above Accept / Decline. */
export function SaleOffer({
  price,
  direction,
  partnerName,
}: {
  price: SalePrice;
  direction: Direction;
  partnerName: string;
}) {
  const t = useTranslations("trades.offer");
  const formatPrice = useFormatPrice();
  const formatted = formatPrice(price);
  return (
    <p className="flex items-center gap-2 text-sm font-semibold">
      <Tag className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
      {direction === "incoming"
        ? t("incoming", { name: partnerName, price: formatted })
        : t("outgoing", { price: formatted })}
    </p>
  );
}

/** How a loan's return date reads everywhere: "Fri, Nov 13, 2026" / "vr 13 nov 2026". */
export const RETURN_DATE_FORMAT = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
} as const;

/** A borrow request's return date in the expanded detail, so the owner sees it before accepting. */
export function ReturnBy({ loanReturnDate }: { loanReturnDate?: number }) {
  const t = useTranslations("trades.returnBy");
  const format = useFormatter();
  return (
    <p className="flex items-center gap-2 text-sm font-semibold">
      <CalendarClock
        className="text-muted-foreground h-4 w-4 shrink-0"
        aria-hidden
      />
      {loanReturnDate === undefined
        ? t("none")
        : t("date", {
            date: format.dateTime(loanReturnDate, RETURN_DATE_FORMAT),
          })}
    </p>
  );
}

/** When an open loan is due back, on its row: nothing without a date, amber once due or late. */
export function LoanDueChip({ expectedReturn }: { expectedReturn?: number }) {
  const t = useTranslations("lending.due");
  const now = useNow({ updateInterval: RELATIVE_TIME_UPDATE_INTERVAL_MS });
  if (expectedReturn === undefined) return null;
  const days = calendarDaysUntil(expectedReturn, now);
  return (
    <span
      className={cn(
        CHIP,
        days <= 0
          ? // amber-800 keeps 12px bold text above 4.5:1 on the tinted chip in light mode.
            "bg-amber-500/15 text-amber-800 dark:text-amber-400"
          : "bg-muted text-foreground",
      )}
    >
      {days < 0 ? t("overdue", { days: -days }) : t("upcoming", { days })}
    </span>
  );
}
