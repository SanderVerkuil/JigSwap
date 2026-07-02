import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import {
  CoverChip,
  EmptyState,
  FilterBar,
} from "@/components/community/primitives";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { ThreadView } from "@/components/messaging/thread-view";
import { LeaveReviewDialog } from "@/components/reputation/leave-review-dialog";
import { ReputationBadge } from "@/components/reputation/reputation-badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftRight,
  CheckCircle,
  MessageCircle,
  Package,
  Tag,
  User,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";

type ExchangeStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "completed"
  | "cancelled"
  | "disputed";

type ExchangeRow = FunctionReturnType<typeof gateway.exchange.incoming>[number];
type BorrowedLoan = FunctionReturnType<typeof gateway.lending.borrowed>[number];

// The pill tabs: All / Incoming / Outgoing / Completed map onto the real
// owner/requester reads and the completed status; Borrowed folds the old
// /borrowed page in as a tab (open loans where the viewer is the borrower).
type ExchangeTab = "all" | "incoming" | "outgoing" | "completed" | "borrowed";

type Direction = "incoming" | "outgoing";

export const Route = createFileRoute("/_dashboard/trades")({
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
  const tLending = useTranslations("lending");

  const [tab, setTab] = useState<ExchangeTab>("all");
  const [statusFilter, setStatusFilter] = useState<ExchangeStatus | "all">(
    "all",
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
  // Open loans the viewer is holding, only fetched once the tab is opened.
  const { data: borrowed } = useQuery(
    convexQuery(gateway.lending.borrowed, tab === "borrowed" ? {} : "skip"),
  );

  if (
    !user ||
    convexUser === undefined ||
    incomingExchanges === undefined ||
    outgoingExchanges === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  // Tag every exchange with its direction once, then filter per tab.
  const tagged: Array<{ exchange: ExchangeRow; direction: Direction }> = [
    ...incomingExchanges.map((exchange) => ({
      exchange,
      direction: "incoming" as const,
    })),
    ...outgoingExchanges.map((exchange) => ({
      exchange,
      direction: "outgoing" as const,
    })),
  ].sort((a, b) => b.exchange.updatedAt - a.exchange.updatedAt);

  const rows = tagged.filter(({ exchange, direction }) => {
    if (tab === "completed") return exchange.status === "completed";
    if (tab === "incoming" && direction !== "incoming") return false;
    if (tab === "outgoing" && direction !== "outgoing") return false;
    return statusFilter === "all" || exchange.status === statusFilter;
  });

  const tabs: Array<{ value: ExchangeTab; label: string }> = [
    { value: "all", label: t("all") },
    { value: "incoming", label: t("incoming") },
    { value: "outgoing", label: t("outgoing") },
    { value: "completed", label: t("completed") },
    { value: "borrowed", label: tLending("borrowedTitle") },
  ];

  const count =
    tab === "borrowed"
      ? borrowed === undefined
        ? undefined
        : tLending("borrowedCount", { count: borrowed.length })
      : t("exchangesCount", { count: rows.length });

  return (
    <div className="flex flex-col gap-[18px]">
      <FilterBar
        filters={tabs}
        value={tab}
        onChange={setTab}
        count={count}
        extra={
          tab !== "completed" &&
          tab !== "borrowed" && (
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as ExchangeStatus | "all")
              }
              className="bg-card focus:ring-primary h-8 rounded-md border px-2 text-sm focus:ring-2 focus:outline-none"
              aria-label={t("allStatuses")}
            >
              <option value="all">{t("allStatuses")}</option>
              {(
                [
                  "proposed",
                  "accepted",
                  "rejected",
                  "cancelled",
                  "disputed",
                ] as const
              ).map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          )
        }
      />

      {tab === "borrowed" ? (
        <BorrowedList borrowed={borrowed} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("noExchanges")}
          sub={t("noExchangesDescription")}
        />
      ) : (
        <div className="flex flex-col">
          {rows.map(({ exchange, direction }, index) => (
            <ExchangeListRow
              key={`${exchange._id}-${direction}`}
              exchange={exchange}
              direction={direction}
              gradientIndex={index}
              viewerId={convexUser?._id}
              isLast={index === rows.length - 1}
            />
          ))}
        </div>
      )}
    </div>
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
}: {
  exchange: ExchangeRow;
  direction: Direction;
  gradientIndex: number;
  viewerId?: string;
  isLast: boolean;
}) {
  const t = useTranslations("trades");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [open, setOpen] = useState(false);

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
  const who =
    (incoming ? exchange.requester?.name : exchange.owner?.name) ?? "";

  const KindIcon = KIND_ICONS[exchange.type] ?? ArrowLeftRight;

  return (
    <div className={cn("py-3", !isLast && "border-b")}>
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
              when: format.relativeTime(exchange.createdAt),
            })}
          </div>
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
          incoming={incoming}
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
  incoming,
  viewerId,
}: {
  exchange: ExchangeRow;
  incoming: boolean;
  viewerId?: string;
}) {
  const t = useTranslations("trades");
  const [chatOpen, setChatOpen] = useState(false);

  const acceptExchange = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.accept),
  });
  const declineExchange = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.decline),
  });
  const completeExchange = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.complete),
  });
  const cancelExchange = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.cancel),
  });

  // The lifecycle mutations key off the domain aggregateId, not the Convex
  // _id; guard against legacy rows lacking one so we never send undefined.
  const run =
    (mutate: (args: { exchangeId: string }) => Promise<unknown>) =>
    async () => {
      if (!exchange.aggregateId) return;
      try {
        await mutate({ exchangeId: exchange.aggregateId });
      } catch (error) {
        console.error("Exchange action failed:", error);
      }
    };

  // The other party relative to the viewer (trust badge + review target).
  const partnerId = (
    exchange.requester?._id === viewerId
      ? exchange.owner?._id
      : exchange.requester?._id
  ) as Id<"users"> | undefined;
  const partnerName =
    exchange.requester?._id === viewerId
      ? exchange.owner?.name
      : exchange.requester?.name;

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

      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <User className="h-4 w-4" />
        <span>
          {incoming
            ? `${t("from")} ${exchange.requester?.name}`
            : `${t("to")} ${exchange.owner?.name}`}
        </span>
        <ReputationBadge memberId={partnerId} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {exchange.status === "proposed" && incoming && (
          <>
            <Button
              size="sm"
              disabled={!exchange.aggregateId}
              onClick={run((args) => acceptExchange.mutateAsync(args))}
            >
              <CheckCircle className="h-4 w-4" />
              {t("accept")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!exchange.aggregateId}
              onClick={run((args) => declineExchange.mutateAsync(args))}
            >
              <XCircle className="h-4 w-4" />
              {t("decline")}
            </Button>
          </>
        )}

        {exchange.status === "proposed" && !incoming && (
          <Button
            variant="outline"
            size="sm"
            disabled={!exchange.aggregateId}
            onClick={run((args) => cancelExchange.mutateAsync(args))}
          >
            <XCircle className="h-4 w-4" />
            {t("cancel")}
          </Button>
        )}

        {exchange.status === "accepted" && (
          <Button
            size="sm"
            disabled={!exchange.aggregateId}
            onClick={run((args) => completeExchange.mutateAsync(args))}
          >
            <CheckCircle className="h-4 w-4" />
            {t("markComplete")}
          </Button>
        )}

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
      </div>

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
    <div className="flex h-80 flex-col rounded-lg border px-3 pb-3">
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

/* ------------------------------------------------------------- Borrowed tab */

// The old /borrowed page folded in as a tab: open loans the viewer holds, as
// divided rows with a Return action. Same lending reads and mutation as the
// standalone page.
function BorrowedList({ borrowed }: { borrowed: BorrowedLoan[] | undefined }) {
  const t = useTranslations("lending");
  const format = useFormatter();
  const returnLoan = useMutation({
    mutationFn: useConvexMutation(gateway.lending.returnLoan),
  });
  // Scope the pending state to the loan being returned so only that row's
  // button disables, exactly as the old per-id busy flag did.
  const returningId = returnLoan.isPending
    ? (returnLoan.variables?.loanId ?? null)
    : null;

  const handleReturn = async (loanId: string) => {
    try {
      await returnLoan.mutateAsync({ loanId });
    } catch (error) {
      console.error("Failed to return loan:", error);
    }
  };

  if (borrowed === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (borrowed.length === 0) {
    return (
      <EmptyState title={t("noBorrowed")} sub={t("noBorrowedDescription")} />
    );
  }

  return (
    <div className="flex flex-col">
      {borrowed.map((loan, index) => (
        <div
          key={loan.loanId}
          className={cn(
            "flex items-center gap-3.5 py-3",
            index < borrowed.length - 1 && "border-b",
          )}
        >
          <CoverChip icon={Package} size={44} gradientIndex={index} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">
              {loan.puzzleTitle}
              <span className="text-muted-foreground font-medium">
                {" "}
                · {t("pieceCount", { count: loan.pieceCount })}
              </span>
            </div>
            <div className="text-muted-foreground mt-0.5 truncate text-xs">
              {t("borrowedFrom", {
                name: loan.lender?.name ?? t("unknownMember"),
              })}{" "}
              ·{" "}
              {t("openedRelative", {
                when: format.relativeTime(loan.openedAt),
              })}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={returningId === loan.loanId}
            onClick={() => handleReturn(loan.loanId)}
          >
            {returningId === loan.loanId ? t("returning") : t("returnAction")}
          </Button>
        </div>
      ))}
    </div>
  );
}
