// One exchange on /trades as an open divided row. The whole summary (the puzzles' covers with a
// kind badge, "Kind · Mine ↔ Theirs" headline, "direction · with who · when" meta, status pill,
// chevron) is ONE disclosure button that expands the detail under it; its name is the row's own
// text, so a speech user can say what they see, and it announces expanded/collapsed. On phones the status pill joins the Your
// turn / offer chips under the meta line, so the title and partner get the row's full width; from
// sm it sits at the row's end. The detail (`children`) is indented under the text only from sm.
import { useRelativeTime } from "@/hooks/use-relative-time";
import { usePartyDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import type { ExchangeSummaryView } from "@jigswap/contracts";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { ExchangeCover } from "./exchange-cover";
import { ExchangeStatusPill, OfferChip, YourTurnPill } from "./exchange-pills";
import {
  confirmationState,
  viewerSide,
  type Direction,
} from "./exchange-state";

/** What the row's summary reads; the detail gets the full exchange from the page. */
export type ListRowExchange = Pick<
  ExchangeSummaryView,
  | "type"
  | "status"
  | "createdAt"
  | "requester"
  | "owner"
  | "requesterState"
  | "ownerState"
  | "requestedPuzzle"
  | "offeredPuzzle"
  | "requestedCoverUrl"
  | "offeredCoverUrl"
  | "salePrice"
  | "initiatorConfirmationTimestamp"
  | "recipientConfirmationTimestamp"
  | "loan"
>;

export function ExchangeListRow({
  exchange,
  direction,
  gradientIndex,
  isLast,
  focused = false,
  children,
}: {
  exchange: ListRowExchange;
  direction: Direction;
  gradientIndex: number;
  isLast: boolean;
  /** Deep-linked from a notification: start expanded, scroll to and highlight the row. */
  focused?: boolean;
  /** The expanded detail, given the counterparty's name exactly as the row shows it. */
  children: (who: string) => ReactNode;
}) {
  const t = useTranslations("trades");
  const partyName = usePartyDisplayName();
  const relativeTime = useRelativeTime();
  const detailId = useId();
  const [open, setOpen] = useState(focused);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const incoming = direction === "incoming";
  // On an exchange the REQUESTED puzzle belongs to the owner, the OFFERED one
  // to the requester — so "mine" depends on which side the viewer is on.
  const mineTitle = incoming
    ? exchange.requestedPuzzle?.title
    : exchange.offeredPuzzle?.title;
  const theirsTitle = incoming
    ? exchange.offeredPuzzle?.title
    : exchange.requestedPuzzle?.title;
  const primary = mineTitle ?? theirsTitle;
  const secondary = mineTitle ? theirsTitle : undefined;
  const counterparty = incoming ? exchange.requester : exchange.owner;
  const who = partyName(
    counterparty,
    incoming ? exchange.requesterState : exchange.ownerState,
  );

  // The covers in the headline's order: a swap shows the viewer's own puzzle in front of theirs;
  // a lend or sale shows its one (requested) copy.
  const covers = exchange.offeredPuzzle
    ? incoming
      ? [exchange.requestedCoverUrl, exchange.offeredCoverUrl]
      : [exchange.offeredCoverUrl, exchange.requestedCoverUrl]
    : [exchange.requestedCoverUrl];
  // Only the partner has confirmed completion: the viewer's confirmation settles it.
  const yourTurn =
    exchange.status === "accepted" &&
    confirmationState(exchange, viewerSide(direction)).mySettles;
  const offer = exchange.type === "sale" ? exchange.salePrice : undefined;

  return (
    <div
      ref={rowRef}
      data-focused={focused || undefined}
      className={cn(
        "py-1.5",
        !isLast && "border-b",
        focused &&
          "bg-jigsaw-primary/5 ring-jigsaw-primary/40 -mx-3 rounded-lg px-3 ring-2",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        // The detail only exists while open.
        aria-controls={open ? detailId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="group hover:bg-muted/50 focus-visible:ring-ring/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-3.5 rounded-lg px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-[3px]"
      >
        <ExchangeCover
          kind={exchange.type}
          covers={covers}
          gradientIndex={gradientIndex}
        />
        <span data-row-text className="min-w-0 flex-1">
          <span className="line-clamp-2 text-base font-semibold">
            {t(`kind.${exchange.type}`)} · {primary}
            {secondary && (
              <span className="text-muted-foreground font-medium">
                {" "}
                ↔ {secondary}
              </span>
            )}
          </span>
          <span className="text-muted-foreground mt-0.5 block text-xs break-words">
            {t("rowMeta", {
              direction: t(`direction.${direction}`),
              who,
              when: relativeTime(exchange.createdAt),
            })}
          </span>
          <span
            className={cn(
              "mt-1.5 flex flex-wrap gap-1.5",
              // From sm the status pill sits at the row's end; keep this line only for the chips.
              !(yourTurn || offer) && "sm:hidden",
            )}
          >
            <ExchangeStatusPill
              status={exchange.status}
              loan={exchange.loan}
              className="sm:hidden"
            />
            {yourTurn && <YourTurnPill />}
            {offer && <OfferChip price={offer} />}
          </span>
        </span>
        <ExchangeStatusPill
          status={exchange.status}
          loan={exchange.loan}
          className="hidden sm:inline-flex"
        />
        <ChevronDown
          aria-hidden
          className={cn(
            "text-muted-foreground group-hover:text-foreground size-5 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div id={detailId} className="mt-1.5 pb-1.5 sm:ml-[60px]">
          {children(who)}
        </div>
      )}
    </div>
  );
}
