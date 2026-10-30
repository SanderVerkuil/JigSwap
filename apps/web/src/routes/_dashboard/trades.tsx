import { useUser } from "@/compat/clerk";
import { CoverChip, FilterBar } from "@/components/community/primitives";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { ExchangeActions } from "@/components/exchange/exchange-actions";
import {
  splitNeedsYou,
  visibleExchanges,
  type ListedExchange,
} from "@/components/exchange/exchange-list";
import {
  OfferChip,
  SaleOffer,
  YourTurnPill,
} from "@/components/exchange/exchange-pills";
import {
  confirmationState,
  viewerSide,
  type Direction,
} from "@/components/exchange/exchange-state";
import { ExchangesEmptyState } from "@/components/exchange/exchanges-empty-state";
import { LoansTab } from "@/components/exchange/loans-tab";
import { TradePartnerCard } from "@/components/exchange/trade-partner-card";
import { ThreadView } from "@/components/messaging/thread-view";
import { LeaveReviewDialog } from "@/components/reputation/leave-review-dialog";
import { ExchangeReportMenu } from "@/components/safety/exchange-report-menu";
import { GuideHelpButton } from "@/components/tour/guide-help-button";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { useTourLauncher } from "@/components/whats-new/tour-launcher";
import { gateway, Id } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import {
  useMemberDisplayName,
  usePartyDisplayName,
} from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import {
  EXCHANGE_STATUSES,
  validateTradesSearch,
  type ExchangeStatus,
  type TradesSearch,
  type TradesTab,
} from "@/lib/trades-search";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, MessageCircle, Package, Tag } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

type ExchangeRow = FunctionReturnType<typeof gateway.exchange.incoming>[number];

// The pill tabs pick one kind of filter, the direction: All / Incoming / Outgoing map onto the
// owner/requester reads; Loans is the one home for open loans, borrowed and lent out (the old
// /borrowed page redirects there). The status is a separate select. Both live in the URL
// (trades-search).

export const Route = createFileRoute("/_dashboard/trades")({
  validateSearch: validateTradesSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "trades") }],
  }),
  pendingComponent: () => <TradesPending />,
  component: ExchangesPage,
});

function TradesPending() {
  const tCommon = useTranslations("common");
  return <PageLoading message={tCommon("loading")} />;
}

// Soft status pill tones (same mapping as the dashboard pulse): Pending and
// Disputed amber, Accepted violet, Completed green, the rest muted.
const PILL_TONES: Record<string, string> = {
  proposed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  accepted: "bg-jigsaw-primary/10 text-jigsaw-primary",
  disputed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  completed: "bg-green-500/15 text-green-700 dark:text-green-400",
};

function StatusPill({ status }: { status: ExchangeStatus }) {
  const t = useTranslations("trades.status");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap",
        PILL_TONES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {t(status)}
    </span>
  );
}

const KIND_ICONS = {
  trade: ArrowLeftRight,
  sale: Tag,
  loan: Package,
} as const;

function ExchangesPage() {
  const { user } = useUser();
  const t = useTranslations("trades");
  const tCommon = useTranslations("common");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const focusedExchange = search.exchange;
  const tab: TradesTab = search.tab ?? "all";
  const statusFilter = search.status;

  // Tab and status are URL state: a change replaces the entry (Back leaves the page, it doesn't
  // step through filters) and drops the ?exchange= highlight, which only a deep link sets.
  const showView = (next: { tab: TradesTab; status?: ExchangeStatus }) =>
    void navigate({
      search: {
        tab: next.tab === "all" ? undefined : next.tab,
        status: next.tab === "loans" ? undefined : next.status,
      } satisfies TradesSearch,
      replace: true,
      resetScroll: false,
    });

  // The page head's "?" starts the exchanges guide at its step on this page.
  const { startTour } = useTourLauncher();
  usePageHeaderActions(
    () => <GuideHelpButton tourId="exchanges" startTour={startTour} />,
    [startTour],
  );

  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  // Incoming = the viewer is the owner; outgoing = the viewer is the requester.
  const { data: incomingExchanges } = useQuery(
    convexQuery(gateway.exchange.incoming, {}),
  );
  const { data: outgoingExchanges } = useQuery(
    convexQuery(gateway.exchange.outgoing, {}),
  );
  // Open loans the viewer holds and the ones they lent out, only fetched on the Loans tab.
  const { data: borrowed } = useQuery(
    convexQuery(gateway.lending.borrowed, tab === "loans" ? {} : "skip"),
  );
  const { data: lentOut } = useQuery(
    convexQuery(gateway.lending.lentOut, tab === "loans" ? {} : "skip"),
  );

  if (
    !user ||
    convexUser === undefined ||
    incomingExchanges === undefined ||
    outgoingExchanges === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  // Tag every exchange with its direction once, then filter per tab and status.
  const tagged: Array<ListedExchange<ExchangeRow>> = [
    ...incomingExchanges.map((exchange) => ({
      exchange,
      direction: "incoming" as const,
    })),
    ...outgoingExchanges.map((exchange) => ({
      exchange,
      direction: "outgoing" as const,
    })),
  ].sort((a, b) => b.exchange.updatedAt - a.exchange.updatedAt);

  const rows =
    tab === "loans" ? [] : visibleExchanges(tagged, tab, statusFilter);
  // What waits on the viewer (answer a request, confirm a handover) is listed first.
  const { needsYou, others } = splitNeedsYou(rows);

  const tabs: Array<{ value: TradesTab; label: string; "data-tour"?: string }> =
    [
      { value: "all", label: t("all") },
      { value: "incoming", label: t("incoming") },
      { value: "outgoing", label: t("outgoing") },
      // The exchanges guide's loans step points at this pill.
      { value: "loans", label: t("loans.tab"), "data-tour": "trades-loans" },
    ];

  const count =
    tab === "loans"
      ? borrowed === undefined || lentOut === undefined
        ? undefined
        : t("loans.count", { count: borrowed.length + lentOut.length })
      : t("exchangesCount", { count: rows.length });

  const renderRows = (group: typeof rows, offset: number) => (
    <div className="flex flex-col">
      {group.map(({ exchange, direction }, index) => {
        const focused =
          focusedExchange !== undefined &&
          (exchange.aggregateId === focusedExchange ||
            exchange._id === focusedExchange);
        return (
          <ExchangeListRow
            // Re-mount when the deep-linked exchange changes so it opens.
            key={`${exchange._id}-${direction}-${focused}`}
            focused={focused}
            exchange={exchange}
            direction={direction}
            gradientIndex={offset + index}
            viewerId={convexUser?._id}
            isLast={index === group.length - 1}
          />
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-[18px]">
      <FilterBar
        data-tour="trades-tabs"
        filters={tabs}
        value={tab}
        onChange={(next) => showView({ tab: next, status: statusFilter })}
        count={count}
        extra={
          tab !== "loans" && (
            <select
              value={statusFilter ?? "all"}
              onChange={(e) =>
                showView({
                  tab,
                  status: EXCHANGE_STATUSES.find(
                    (status) => status === e.target.value,
                  ),
                })
              }
              className="bg-card focus:ring-primary h-8 rounded-md border px-2 text-sm focus:ring-2 focus:outline-none"
              aria-label={t("statusFilter")}
            >
              <option value="all">{t("allStatuses")}</option>
              {EXCHANGE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          )
        }
      />

      {tab === "loans" ? (
        <LoansTab borrowed={borrowed} lentOut={lentOut} />
      ) : rows.length === 0 ? (
        <ExchangesEmptyState
          tab={tab}
          status={statusFilter}
          onShowAllStatuses={() => showView({ tab })}
        />
      ) : needsYou.length === 0 ? (
        renderRows(others, 0)
      ) : (
        <>
          <ExchangeGroup title={t("groups.needsYou")} count={needsYou.length}>
            {renderRows(needsYou, 0)}
          </ExchangeGroup>
          {others.length > 0 && (
            <ExchangeGroup title={t("groups.others")} count={others.length}>
              {renderRows(others, needsYou.length)}
            </ExchangeGroup>
          )}
        </>
      )}
    </div>
  );
}

// A titled run of exchange rows ("Needs you", "Other exchanges"), only used when something waits on
// the viewer; otherwise the list renders without headings.
function ExchangeGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="font-heading flex items-baseline gap-2 text-lg font-bold"
      >
        {title}
        <span className="text-muted-foreground text-sm font-medium">
          {count}
        </span>
      </h2>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------- Exchange row */

// One exchange as an open divided row: gradient kind chip, "Kind · Mine ↔
// Theirs" headline, "direction · with who · when" meta, status pill, and an
// outline View toggle that expands the full detail (puzzles, partner trust,
// and every lifecycle action the old card offered).
function ExchangeListRow({
  exchange,
  direction,
  gradientIndex,
  viewerId,
  isLast,
  focused = false,
}: {
  focused?: boolean;
  exchange: ExchangeRow;
  direction: Direction;
  gradientIndex: number;
  viewerId?: string;
  isLast: boolean;
}) {
  const t = useTranslations("trades");
  const partyName = usePartyDisplayName();
  const tCommon = useTranslations("common");
  const relativeTime = useRelativeTime();
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

  const KindIcon = KIND_ICONS[exchange.type] ?? ArrowLeftRight;
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
        "py-3",
        !isLast && "border-b",
        focused &&
          "bg-jigsaw-primary/5 ring-jigsaw-primary/40 -mx-3 rounded-lg px-3 ring-2",
      )}
    >
      <div className="flex items-center gap-3.5">
        <CoverChip icon={KindIcon} size={44} gradientIndex={gradientIndex} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">
            {t(`kind.${exchange.type}`)} · {primary}
            {secondary && (
              <span className="text-muted-foreground font-medium">
                {" "}
                ↔ {secondary}
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 truncate text-xs">
            {t("rowMeta", {
              direction: t(`direction.${direction}`),
              who,
              when: relativeTime(exchange.createdAt),
            })}
          </div>
          {(yourTurn || offer) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {yourTurn && <YourTurnPill />}
              {offer && <OfferChip price={offer} />}
            </div>
          )}
        </div>
        <StatusPill status={exchange.status} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((value) => !value)}
        >
          {tCommon("view")}
        </Button>
      </div>

      {open && (
        <ExchangeDetail
          exchange={exchange}
          direction={direction}
          who={who}
          viewerId={viewerId}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Exchange detail */

// The expanded detail under a row — the full content of the old exchange card:
// requested/offered puzzles, the partner with their trust badge, and the
// status-appropriate lifecycle actions (accept/decline, cancel, complete,
// review, message).
function ExchangeDetail({
  exchange,
  direction,
  who,
  viewerId,
}: {
  exchange: ExchangeRow;
  direction: Direction;
  // The counterparty's name exactly as the row shows it ("Deleted member" when gone).
  who: string;
  viewerId?: string;
}) {
  const t = useTranslations("trades");
  const displayName = useMemberDisplayName();
  const [chatOpen, setChatOpen] = useState(false);
  const incoming = direction === "incoming";

  // The other party relative to the viewer (trust badge + review target).
  const partnerId = (
    exchange.requester?._id === viewerId
      ? exchange.owner?._id
      : exchange.requester?._id
  ) as Id<"users"> | undefined;
  const partner =
    exchange.requester?._id === viewerId ? exchange.owner : exchange.requester;
  const partnerName = partner ? displayName(partner) : undefined;

  return (
    <div className="mt-3 ml-[60px] flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PuzzleSummary
          label={incoming ? t("theyWant") : t("youWant")}
          title={exchange.requestedPuzzle?.title}
          pieceCount={exchange.requestedPuzzle?.pieceCount}
        />
        {exchange.offeredPuzzle && (
          <PuzzleSummary
            label={incoming ? t("theyOffer") : t("youOffer")}
            title={exchange.offeredPuzzle?.title}
            pieceCount={exchange.offeredPuzzle?.pieceCount}
          />
        )}
      </div>

      <TradePartnerCard
        exchangeId={exchange._id}
        label={incoming ? t("from") : t("to")}
        viewerIsRequester={!incoming}
      />

      {exchange.type === "sale" && exchange.salePrice && (
        <SaleOffer
          price={exchange.salePrice}
          direction={direction}
          partnerName={who}
        />
      )}

      <ExchangeActions
        exchange={exchange}
        direction={direction}
        partnerName={who}
        requestedTitle={exchange.requestedPuzzle?.title}
        offeredTitle={exchange.offeredPuzzle?.title}
      >
        {/* Review the partner once completed; the dialog hides itself when the
            viewer has already reviewed this exchange. */}
        {exchange.status === "completed" && (
          <LeaveReviewDialog
            exchangeId={exchange.aggregateId}
            revieweeId={partnerId}
            revieweeName={partnerName}
          />
        )}

        <Button
          variant="ghost"
          size="sm"
          aria-expanded={chatOpen}
          onClick={() => setChatOpen((value) => !value)}
        >
          <MessageCircle className="h-4 w-4" />
          {t("message")}
        </Button>

        {partner && (
          <ExchangeReportMenu
            exchangeId={exchange.aggregateId ?? exchange._id}
            partnerId={partnerId}
            partnerName={displayName(partner)}
          />
        )}
      </ExchangeActions>

      {chatOpen && (
        <ExchangeChat exchangeId={exchange.aggregateId ?? exchange._id} />
      )}
    </div>
  );
}

// The exchange's conversation thread, inline under the detail: resolved via
// the conversation gateway (the thread the subscriber opened on propose) and
// rendered headerless — the surrounding card already names the trade. Null
// means a legacy pre-backfill exchange without a thread.
function ExchangeChat({ exchangeId }: { exchangeId: string }) {
  const t = useTranslations("messages");
  const { member } = useCurrentMember();
  const { data: threadId } = useQuery(
    convexQuery(
      gateway.conversation.getThreadByExchange,
      member ? { exchangeId } : "skip",
    ),
  );

  if (threadId === undefined) {
    return (
      <div className="bg-muted h-24 animate-pulse rounded-lg" aria-hidden />
    );
  }
  if (threadId === null) {
    return <p className="text-muted-foreground text-sm">{t("noThreadYet")}</p>;
  }
  return (
    <div className="flex h-80 flex-col overflow-hidden rounded-lg border">
      <ThreadView threadId={threadId} hideHeader />
    </div>
  );
}

function PuzzleSummary({
  label,
  title,
  pieceCount,
}: {
  label: string;
  title?: string;
  pieceCount?: number;
}) {
  const tLending = useTranslations("lending");
  return (
    <div>
      <h4 className="text-muted-foreground text-sm font-medium">{label}</h4>
      <div className="bg-muted/50 mt-1.5 flex items-center gap-3 rounded-lg p-3">
        <Package className="text-muted-foreground h-7 w-7" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          {pieceCount != null && (
            <p className="text-muted-foreground text-xs">
              {tLending("pieceCount", { count: pieceCount })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
