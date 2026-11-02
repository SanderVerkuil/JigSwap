"use client";

import { Link } from "@/compat/link";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useMemberToday } from "@/hooks/use-member-today";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { currentGoals } from "@/lib/goal-form";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { CircleCheck, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { MY_SHELF_SIZE } from "./shelf-section";
import { useCurrentMember } from "./use-current-member";

type ExchangeRow = FunctionReturnType<typeof gateway.exchange.myLive>[number];

function HeadlineLink({
  href,
  tone = "violet",
  children,
}: {
  href: string;
  tone?: "violet" | "green";
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "underline decoration-2 underline-offset-[5px] transition-colors",
        tone === "green"
          ? "text-jigsaw-secondary-text decoration-jigsaw-secondary/30 hover:decoration-jigsaw-secondary"
          : "text-primary-text decoration-jigsaw-primary/30 hover:decoration-jigsaw-primary",
      )}
    >
      {children}
    </Link>
  );
}

export type HeadlineVariant =
  | "swapsPendingGoal"
  | "swapsPending"
  | "swapsGoal"
  | "swapsOnly"
  | "pendingGoal"
  | "pendingOnly"
  | "goalOnly"
  | "shelfOffered"
  | "shelfOnly"
  | "empty";

// Which headline sentence fits: swaps, waiting requests and goal progress lead
// (every combination has its own sentence); with none of those, the member's
// shelf does: puzzles up for swap send them browsing, puzzles not offered yet
// get a nudge to offer a few. Only an empty shelf gets the first-puzzle line.
export function headlineVariant({
  activeCount,
  pendingCount,
  hasGoal,
  ownedCount,
  offeredCount,
}: {
  activeCount: number;
  pendingCount: number;
  hasGoal: boolean;
  ownedCount: number;
  offeredCount: number;
}): HeadlineVariant {
  if (activeCount > 0) {
    if (pendingCount > 0) return hasGoal ? "swapsPendingGoal" : "swapsPending";
    return hasGoal ? "swapsGoal" : "swapsOnly";
  }
  if (pendingCount > 0) return hasGoal ? "pendingGoal" : "pendingOnly";
  if (hasGoal) return "goalOnly";
  if (offeredCount > 0) return "shelfOffered";
  if (ownedCount > 0) return "shelfOnly";
  return "empty";
}

// The narrative headline: one large friendly sentence summarising the member's
// world, with the live numbers as inline underlined links (see headlineVariant
// for which sentence is picked).
export function Headline({
  activeCount,
  pendingCount,
  goal,
  ownedCount,
  offeredCount,
}: {
  activeCount: number;
  pendingCount: number;
  goal: { pct: number; target: number } | null;
  ownedCount: number;
  offeredCount: number;
}) {
  const t = useTranslations("dashboard.brief");
  const variant = headlineVariant({
    activeCount,
    pendingCount,
    hasGoal: goal !== null,
    ownedCount,
    offeredCount,
  });

  return (
    <p className="font-heading max-w-[860px] text-xl leading-snug font-semibold tracking-tight text-pretty md:text-3xl md:leading-[1.4]">
      {t.rich(variant, {
        swapsCount: activeCount,
        pendingCount,
        pct: goal?.pct ?? 0,
        target: goal?.target ?? 0,
        ownedCount,
        offeredCount,
        swapsLink: (chunks) => (
          <HeadlineLink href="/trades">{chunks}</HeadlineLink>
        ),
        goalLink: (chunks) => (
          <HeadlineLink href="/goals" tone="green">
            {chunks}
          </HeadlineLink>
        ),
        shelfLink: (chunks) => (
          // The offered ones when the words say how many are up for swap, not the whole shelf.
          <HeadlineLink
            href={
              variant === "shelfOffered"
                ? "/my-puzzles?status=forTrade"
                : "/my-puzzles"
            }
          >
            {chunks}
          </HeadlineLink>
        ),
        browseLink: (chunks) => (
          <HeadlineLink href="/browse">{chunks}</HeadlineLink>
        ),
      })}
    </p>
  );
}

// The first pending incoming request, surfaced as an actionable banner row.
function PendingRequestBanner({ exchange }: { exchange: ExchangeRow }) {
  const t = useTranslations("dashboard.pendingBanner");
  const relativeTime = useRelativeTime();
  const displayName = useMemberDisplayName();

  const requester = exchange.requester;
  const mine = exchange.requestedPuzzle?.title;
  const theirs = exchange.offeredPuzzle?.title;
  if (!requester || !mine) return null;

  const message = theirs
    ? t.rich("swap", {
        name: displayName(requester),
        theirs,
        mine,
        strong: (chunks) => (
          <strong className="text-foreground">{chunks}</strong>
        ),
        mineStrong: (chunks) => (
          <strong className="text-primary-text">{chunks}</strong>
        ),
      })
    : t.rich(
        exchange.type === "loan"
          ? "borrow"
          : exchange.type === "sale"
            ? "buy"
            : "want",
        {
          name: displayName(requester),
          mine,
          strong: (chunks) => (
            <strong className="text-foreground">{chunks}</strong>
          ),
          mineStrong: (chunks) => (
            <strong className="text-primary-text">{chunks}</strong>
          ),
        },
      );

  return (
    <div className="border-jigsaw-primary/20 bg-jigsaw-primary/5 flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3">
      <Avatar className="size-10">
        {requester.avatar && (
          <AvatarImage src={requester.avatar} alt={displayName(requester)} />
        )}
        <AvatarFallback>
          <MemberInitial source={requester} />
        </AvatarFallback>
      </Avatar>
      <div className="text-muted-foreground min-w-0 flex-1 text-sm">
        {message}
        <span> · {relativeTime(exchange.createdAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" asChild>
          <Link href="/trades">{t("accept")}</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href="/messages">{t("reply")}</Link>
        </Button>
      </div>
    </div>
  );
}

// Small rounded quick-action chips with violet icons.
function QuickActions() {
  const t = useTranslations("dashboard.actions");
  const actions = [
    { icon: Plus, label: t("addPuzzle"), href: "/my-puzzles/add" },
    { icon: Search, label: t("browse"), href: "/browse" },
    { icon: CircleCheck, label: t("logCompletion"), href: "/completions/new" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ icon: Icon, label, href }) => (
        <Link
          key={href}
          href={href}
          className="bg-background hover:bg-accent inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors pointer-coarse:min-h-11"
        >
          <Icon className="text-jigsaw-primary size-[15px]" />
          {label}
        </Link>
      ))}
    </div>
  );
}

// The editorial "morning briefing" opener: narrative headline, the waiting
// request as a banner, and the quick-action pills — no boxes, no page h1 (the
// shell chrome owns the greeting).
export function BriefingHero() {
  const { member, isMemberLoading } = useCurrentMember();
  const today = useMemberToday();

  const { data: exchanges } = useQuery(
    // Only what's still in play: finished exchanges have no part in the headline.
    convexQuery(gateway.exchange.myLive, member?._id ? {} : "skip"),
  );
  const { data: goals } = useQuery(
    convexQuery(gateway.solving.myGoals, member?._id ? {} : "skip"),
  );
  // Same args as the shelf's read, so both share one subscription. Its counts come from the member's
  // counters, so the headline doesn't read the library.
  const { data: shelf } = useQuery(
    convexQuery(
      gateway.library.myShelf,
      member?._id ? { limit: MY_SHELF_SIZE } : "skip",
    ),
  );

  const loading =
    isMemberLoading ||
    (member != null &&
      (exchanges === undefined || goals === undefined || shelf === undefined));

  if (loading) {
    return (
      <section className="flex flex-col gap-4 md:gap-5">
        <div className="max-w-[860px] space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-40 rounded-full" />
          <Skeleton className="h-8 w-36 rounded-full" />
        </div>
      </section>
    );
  }

  const active = exchanges ?? [];
  const pendingIncoming = (exchanges ?? []).filter(
    (e) => e.userRole === "owner" && e.status === "proposed",
  );

  const activeGoal = currentGoals(goals ?? [], today)[0];
  const goal =
    activeGoal && activeGoal.targetCompletions > 0
      ? {
          pct: Math.min(
            100,
            Math.round(
              (activeGoal.currentCompletions / activeGoal.targetCompletions) *
                100,
            ),
          ),
          target: activeGoal.targetCompletions,
        }
      : null;

  return (
    <section className="flex flex-col gap-4 md:gap-5">
      <Headline
        activeCount={active.length}
        pendingCount={pendingIncoming.length}
        goal={goal}
        ownedCount={shelf?.total ?? 0}
        offeredCount={shelf?.forTrade ?? 0}
      />
      {pendingIncoming[0] && (
        <PendingRequestBanner exchange={pendingIncoming[0]} />
      )}
      <QuickActions />
    </section>
  );
}
