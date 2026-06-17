"use client";

import { Link } from "@/compat/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CircleCheck, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useCurrentMember } from "./use-current-member";

type ExchangeRow = FunctionReturnType<typeof gateway.exchange.forUser>[number];

// Exchanges that still need somebody's attention.
const ACTIVE_STATUSES = new Set(["proposed", "accepted", "disputed"]);

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
          ? "text-jigsaw-secondary decoration-jigsaw-secondary/30 hover:decoration-jigsaw-secondary"
          : "text-jigsaw-primary decoration-jigsaw-primary/30 hover:decoration-jigsaw-primary",
      )}
    >
      {children}
    </Link>
  );
}

// The narrative headline: one large friendly sentence summarising the member's
// world, with the live numbers as inline underlined links. Variants cover every
// combination of swaps / pending requests / goal progress so plural and zero
// cases all read naturally; with no data at all it falls back to a warm
// welcome line.
function Headline({
  activeCount,
  pendingCount,
  goal,
}: {
  activeCount: number;
  pendingCount: number;
  goal: { pct: number; target: number } | null;
}) {
  const t = useTranslations("dashboard.brief");

  const hasSwaps = activeCount > 0;
  const hasPending = pendingCount > 0;
  const variant = hasSwaps
    ? hasPending
      ? goal
        ? "swapsPendingGoal"
        : "swapsPending"
      : goal
        ? "swapsGoal"
        : "swapsOnly"
    : hasPending
      ? goal
        ? "pendingGoal"
        : "pendingOnly"
      : goal
        ? "goalOnly"
        : null;

  return (
    <p className="font-heading max-w-[860px] text-xl leading-snug font-semibold tracking-tight text-pretty md:text-3xl md:leading-[1.4]">
      {variant === null
        ? t("empty")
        : t.rich(variant, {
            swapsCount: activeCount,
            pendingCount,
            pct: goal?.pct ?? 0,
            target: goal?.target ?? 0,
            swapsLink: (chunks) => (
              <HeadlineLink href="/trades">{chunks}</HeadlineLink>
            ),
            goalLink: (chunks) => (
              <HeadlineLink href="/goals" tone="green">
                {chunks}
              </HeadlineLink>
            ),
          })}
    </p>
  );
}

// The first pending incoming request, surfaced as an actionable banner row.
function PendingRequestBanner({ exchange }: { exchange: ExchangeRow }) {
  const t = useTranslations("dashboard.pendingBanner");
  const format = useFormatter();

  const requester = exchange.requester;
  const mine = exchange.requestedPuzzle?.title;
  const theirs = exchange.offeredPuzzle?.title;
  if (!requester || !mine) return null;

  const message = theirs
    ? t.rich("swap", {
        name: requester.name,
        theirs,
        mine,
        strong: (chunks) => (
          <strong className="text-foreground">{chunks}</strong>
        ),
        mineStrong: (chunks) => (
          <strong className="text-jigsaw-primary">{chunks}</strong>
        ),
      })
    : t.rich(
        exchange.type === "loan"
          ? "borrow"
          : exchange.type === "sale"
            ? "buy"
            : "want",
        {
          name: requester.name,
          mine,
          strong: (chunks) => (
            <strong className="text-foreground">{chunks}</strong>
          ),
          mineStrong: (chunks) => (
            <strong className="text-jigsaw-primary">{chunks}</strong>
          ),
        },
      );

  return (
    <div className="border-jigsaw-primary/20 bg-jigsaw-primary/5 flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3">
      <Avatar className="size-10">
        {requester.avatar && (
          <AvatarImage src={requester.avatar} alt={requester.name} />
        )}
        <AvatarFallback>
          {requester.name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="text-muted-foreground min-w-0 flex-1 text-sm">
        {message}
        <span> · {format.relativeTime(exchange.createdAt)}</span>
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
    { icon: CircleCheck, label: t("logCompletion"), href: "/completions" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ icon: Icon, label, href }) => (
        <Link
          key={href}
          href={href}
          className="bg-background hover:bg-accent inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors"
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

  const exchanges = useQuery(
    gateway.exchange.forUser,
    member?._id ? {} : "skip",
  );
  const goals = useQuery(gateway.solving.myGoals, member?._id ? {} : "skip");

  const loading =
    isMemberLoading ||
    (member != null && (exchanges === undefined || goals === undefined));

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

  const active = (exchanges ?? []).filter((e) => ACTIVE_STATUSES.has(e.status));
  const pendingIncoming = (exchanges ?? []).filter(
    (e) => e.userRole === "owner" && e.status === "proposed",
  );

  const activeGoal =
    (goals ?? []).find((g) => g.isActive && !g.isAchieved) ??
    (goals ?? []).find((g) => g.isActive);
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
      />
      {pendingIncoming[0] && (
        <PendingRequestBanner exchange={pendingIncoming[0]} />
      )}
      <QuickActions />
    </section>
  );
}
