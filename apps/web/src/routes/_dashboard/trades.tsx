import { useUser } from "@/compat/clerk";
import { FilterBar } from "@/components/community/primitives";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { ExchangeActions } from "@/components/exchange/exchange-actions";
import { CoverTile } from "@/components/exchange/exchange-cover";
import {
  splitNeedsYou,
  visibleExchanges,
  type ListedExchange,
} from "@/components/exchange/exchange-list";
import { ExchangeListRow } from "@/components/exchange/exchange-list-row";
import { ReturnBy, SaleOffer } from "@/components/exchange/exchange-pills";
import type { Direction } from "@/components/exchange/exchange-state";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import {
  EXCHANGE_STATUSES,
  validateTradesSearch,
  type ExchangeStatus,
  type TradesSearch,
  type TradesTab,
} from "@/lib/trades-search";
import { convexQuery } from "@convex-dev/react-query";
import { LIVE_EXCHANGES_PER_READ } from "@jigswap/contracts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
// Not convex/react's: this list is read through stream(), whose pages only keep their ends when the
// client pins them, and this hook does (without it, a change loses or repeats a row between pages).
import { usePaginatedQuery } from "convex-helpers/react";
import type { FunctionReturnType } from "convex/server";
import { MessageCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

type ExchangeRow = FunctionReturnType<typeof gateway.exchange.myLive>[number];

// How many finished exchanges a page adds.
const HISTORY_PAGE_SIZE = 20;

// The statuses that are read a page at a time; the rest are in play and read whole.
const FINISHED_STATUSES = ["completed", "rejected", "cancelled"] as const;
type FinishedStatus = (typeof FINISHED_STATUSES)[number];
const isFinishedStatus = (status: ExchangeStatus): status is FinishedStatus =>
  (FINISHED_STATUSES as readonly ExchangeStatus[]).includes(status);

// The pill tabs pick one kind of filter, the direction: All / Incoming / Outgoing; Loans is the one
// home for open loans, borrowed and lent out (the old /borrowed page redirects there). The status is
// a separate select. Both live in the URL (trades-search). What's still in play is always read whole,
// because any of it can need the member's answer; finished exchanges come a page at a time.

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

  // The "?" starts the exchanges guide at its step on this page. From md it sits in the shell's
  // page head. On phones the shell would give it a row of its own above the page (the top bar
  // already carries the title), so there it ends the filter bar's controls row instead.
  const { startTour } = useTourLauncher();
  const isMobile = useIsMobile();
  usePageHeaderActions(
    () =>
      isMobile ? null : (
        <GuideHelpButton tourId="exchanges" startTour={startTour} />
      ),
    [startTour, isMobile],
  );

  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  const { data: liveExchanges } = useQuery(
    convexQuery(gateway.exchange.myLive, {}),
  );
  // One read joins a window of what's in play, the most recently active first. A member with more
  // than that opens the next window here, because any of them can need their answer. Only a full
  // window can have another behind it.
  const [liveWindows, setLiveWindows] = useState(1);
  const olderLive = useQueries({
    queries: Array.from({ length: liveWindows - 1 }, (_, i) =>
      convexQuery(gateway.exchange.myLive, { page: i + 1 }),
    ),
  });
  const newestWindow =
    olderLive.length === 0 ? liveExchanges : olderLive.at(-1)?.data;
  const hasMoreLive =
    tab !== "loans" && newestWindow?.length === LIVE_EXCHANGES_PER_READ;
  const loadingOlderLive = olderLive.some(
    (window) => window.data === undefined && window.error === null,
  );
  // A live status filter needs no history; neither does the Loans tab.
  const wantsHistory =
    tab !== "loans" &&
    (statusFilter === undefined || isFinishedStatus(statusFilter));
  const {
    results: finishedExchanges,
    status: historyStatus,
    loadMore,
  } = usePaginatedQuery(
    gateway.exchange.myHistory,
    wantsHistory
      ? {
          direction: tab,
          ...(statusFilter !== undefined && isFinishedStatus(statusFilter)
            ? { status: statusFilter }
            : {}),
        }
      : "skip",
    { initialNumItems: HISTORY_PAGE_SIZE },
  );
  const historyLoading = wantsHistory && historyStatus === "LoadingFirstPage";
  const hasMoreHistory =
    wantsHistory &&
    (historyStatus === "CanLoadMore" || historyStatus === "LoadingMore");
  // A deep link can name a finished exchange past the pages loaded so far: read that one as well.
  const { data: linkedExchange } = useQuery(
    convexQuery(
      gateway.exchange.mySummary,
      focusedExchange !== undefined ? { exchange: focusedExchange } : "skip",
    ),
  );
  // Open loans the viewer holds and the ones they lent out, only fetched on the Loans tab.
  const { data: borrowed } = useQuery(
    convexQuery(gateway.lending.borrowed, tab === "loans" ? {} : "skip"),
  );
  const { data: lentOut } = useQuery(
    convexQuery(gateway.lending.lentOut, tab === "loans" ? {} : "skip"),
  );

  if (!user || convexUser === undefined || liveExchanges === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  // Tag every exchange with its direction once (incoming = the viewer is the owner, outgoing = the
  // viewer is the requester), then filter per tab and status. Newest activity first, as loaded so
  // far: a page of older exchanges joins below what's there, around any old one still in play.
  const loaded = new Map<string, ExchangeRow>();
  for (const exchange of [
    ...liveExchanges,
    ...olderLive.flatMap((window) => window.data ?? []),
    ...finishedExchanges,
    ...(linkedExchange ? [linkedExchange] : []),
  ]) {
    loaded.set(exchange._id, exchange);
  }
  const tagged: Array<ListedExchange<ExchangeRow>> = [...loaded.values()]
    .map((exchange) => ({
      exchange,
      direction:
        exchange.userRole === "owner"
          ? ("incoming" as const)
          : ("outgoing" as const),
    }))
    .sort((a, b) => b.exchange.updatedAt - a.exchange.updatedAt);

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
      : t(
          hasMoreHistory || hasMoreLive
            ? "exchangesCountMore"
            : "exchangesCount",
          { count: rows.length },
        );

  const renderRow = (
    { exchange, direction }: (typeof rows)[number],
    position: { index: number; isLast: boolean },
  ) => {
    const focused =
      focusedExchange !== undefined &&
      (exchange.aggregateId === focusedExchange ||
        exchange._id === focusedExchange);
    return (
      <ExchangeListRow
        key={`${exchange._id}-${direction}`}
        focused={focused}
        exchange={exchange}
        direction={direction}
        gradientIndex={position.index}
        isLast={position.isLast}
      >
        {(who) => (
          <ExchangeDetail
            exchange={exchange}
            direction={direction}
            who={who}
            viewerId={convexUser?._id}
          />
        )}
      </ExchangeListRow>
    );
  };

  // Rows and group headings are siblings in ONE flat keyed array, on purpose. A live update can move
  // a row to the other group, or make the groups appear around it, and a row owns state that has to
  // survive that: what's open, its chat, the composer's draft, the member's focus. A wrapper per
  // group, or a nested array, would remount it.
  const list: ReactNode[] = [
    ...(needsYou.length > 0
      ? [
          <ExchangeGroupHeading
            key="group-needs-you"
            title={t("groups.needsYou")}
            count={needsYou.length}
          />,
        ]
      : []),
    ...needsYou.map((row, index) =>
      renderRow(row, { index, isLast: index === needsYou.length - 1 }),
    ),
    ...(needsYou.length > 0 && others.length > 0
      ? [
          <ExchangeGroupHeading
            key="group-others"
            title={t("groups.others")}
            count={
              hasMoreHistory || hasMoreLive
                ? `${others.length}+`
                : others.length
            }
          />,
        ]
      : []),
    ...others.map((row, index) =>
      renderRow(row, {
        index: needsYou.length + index,
        isLast: index === others.length - 1,
      }),
    ),
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <FilterBar
        data-tour="trades-tabs"
        filters={tabs}
        value={tab}
        onChange={(next) => showView({ tab: next, status: statusFilter })}
        // On phones the count moves into `extra` so the "?" can follow it.
        count={isMobile ? undefined : count}
        extra={
          <>
            {tab !== "loans" && (
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
                className="bg-card focus:ring-primary h-8 rounded-md border px-2 text-base focus:ring-2 focus:outline-none md:not-pointer-coarse:text-sm pointer-coarse:h-11"
                aria-label={t("statusFilter")}
              >
                <option value="all">{t("allStatuses")}</option>
                {EXCHANGE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            )}
            {isMobile && (
              <>
                {count != null && (
                  <span className="text-muted-foreground text-sm">{count}</span>
                )}
                <GuideHelpButton tourId="exchanges" startTour={startTour} />
              </>
            )}
          </>
        }
      />

      {tab === "loans" ? (
        <LoansTab borrowed={borrowed} lentOut={lentOut} />
      ) : rows.length === 0 && historyLoading ? (
        <PageLoading message={tCommon("loading")} />
      ) : rows.length === 0 && !hasMoreHistory && !hasMoreLive ? (
        <ExchangesEmptyState
          tab={tab}
          status={statusFilter}
          onShowAllStatuses={() => showView({ tab })}
        />
      ) : (
        <div className="flex flex-col">{list}</div>
      )}

      {/* aria-disabled, not disabled, while the next page loads: a disabled button drops focus. */}
      {(hasMoreHistory || hasMoreLive || loadingOlderLive) && (
        <Button
          variant="outline"
          className="h-11 self-center md:h-9"
          aria-disabled={historyStatus === "LoadingMore" || loadingOlderLive}
          onClick={() => {
            if (loadingOlderLive) return;
            // What's in play before what's finished.
            if (hasMoreLive) setLiveWindows((windows) => windows + 1);
            else if (historyStatus === "CanLoadMore") {
              loadMore(HISTORY_PAGE_SIZE);
            }
          }}
        >
          {historyStatus === "LoadingMore" || loadingOlderLive
            ? tCommon("loading")
            : t("showMore")}
        </Button>
      )}
    </div>
  );
}

// The heading above a run of exchange rows ("Needs you", "Other exchanges"), only used when something
// waits on the viewer; otherwise the list renders without headings.
function ExchangeGroupHeading({
  title,
  count,
}: {
  title: string;
  count: number | string;
}) {
  return (
    <h2 className="font-heading flex items-baseline gap-2 text-lg font-bold not-first:mt-[18px]">
      {title}
      <span className="text-muted-foreground text-sm font-medium">{count}</span>
    </h2>
  );
}

/* ----------------------------------------------------------- Exchange detail */

// The expanded detail under a row (ExchangeListRow places and indents it) — the
// full content of the old exchange card: requested/offered puzzles, the partner
// with their trust badge, and the status-appropriate lifecycle actions
// (accept/decline, cancel, complete, review, message).
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
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PuzzleSummary
          label={incoming ? t("theyWant") : t("youWant")}
          title={exchange.requestedPuzzle?.title}
          pieceCount={exchange.requestedPuzzle?.pieceCount}
          coverUrl={exchange.requestedCoverUrl}
        />
        {exchange.offeredPuzzle && (
          <PuzzleSummary
            label={incoming ? t("theyOffer") : t("youOffer")}
            title={exchange.offeredPuzzle?.title}
            pieceCount={exchange.offeredPuzzle?.pieceCount}
            coverUrl={exchange.offeredCoverUrl}
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

      {/* A loan's agreed return date (or that there is none), before it is accepted and after. */}
      {exchange.type === "loan" && (
        <ReturnBy loanReturnDate={exchange.loanReturnDate} />
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

        {/* Icon-only on phones so the ⋯ keeps its place on this row; still the accessible name. */}
        <Button
          variant="ghost"
          size="sm"
          className="max-sm:size-11"
          aria-expanded={chatOpen}
          onClick={() => setChatOpen((value) => !value)}
        >
          <MessageCircle className="h-4 w-4" />
          <span className="max-sm:sr-only">{t("message")}</span>
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

// One side of the exchange in the detail: its cover (a puzzle glyph without one), title and size.
function PuzzleSummary({
  label,
  title,
  pieceCount,
  coverUrl,
}: {
  label: string;
  title?: string;
  pieceCount?: number;
  coverUrl?: string | null;
}) {
  const tLending = useTranslations("lending");
  return (
    <div>
      <h4 className="text-muted-foreground text-sm font-medium">{label}</h4>
      <div className="bg-muted/50 mt-1.5 flex items-center gap-3 rounded-lg p-3">
        <CoverTile url={coverUrl} />
        <div className="min-w-0">
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
