// Small status chips shared by the exchange row and its expanded detail.
import { cn } from "@/lib/utils";
import type { ExchangeFields } from "@jigswap/contracts";
import { Tag } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import type { Direction } from "./exchange-state";

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
        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
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
