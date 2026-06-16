"use client";

import { Link } from "@/compat/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, Bell, Package, Target } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { SectionHead } from "./section-head";
import { useCurrentMember } from "./use-current-member";

type ExchangeRow = FunctionReturnType<typeof gateway.exchange.forUser>[number];
type GoalRow = FunctionReturnType<typeof gateway.solving.myGoals>[number];
type ActivityEntry = FunctionReturnType<
  typeof gateway.social.activityFeed
>[number];
type Member = NonNullable<ReturnType<typeof useCurrentMember>["member"]>;

// Exchanges that still need somebody's attention come first in the timeline.
const ACTIVE_STATUSES = new Set(["proposed", "accepted", "disputed"]);

/* ----------------------------------------------------------- In Motion */

// Soft status pill tones: Pending amber, Accepted/Disputed violet,
// Completed green — everything else muted.
const PILL_TONES: Record<string, string> = {
  proposed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  accepted: "bg-jigsaw-primary/10 text-jigsaw-primary",
  disputed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  completed: "bg-green-500/15 text-green-700 dark:text-green-400",
};

// Solid circle colors for the timeline markers, matching the pill hues.
const DOT_TONES: Record<string, string> = {
  proposed: "bg-jigsaw-warning",
  accepted: "bg-jigsaw-primary",
  disputed: "bg-jigsaw-warning",
  completed: "bg-jigsaw-secondary",
};

function StatusPill({ status }: { status: ExchangeRow["status"] }) {
  const t = useTranslations("dashboard.pulse.inMotion.status");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
        PILL_TONES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {t(status)}
    </span>
  );
}

function ExchangeTimelineRow({
  exchange,
  isLast,
}: {
  exchange: ExchangeRow;
  isLast: boolean;
}) {
  const t = useTranslations("dashboard.pulse.inMotion");

  const incoming = exchange.userRole === "owner";
  // On an exchange the REQUESTED puzzle belongs to the owner; the OFFERED one
  // to the requester. "Mine" therefore depends on which side I'm on.
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

  const KindIcon = exchange.type === "loan" ? Package : ArrowLeftRight;

  return (
    <Link href="/trades" className="group flex gap-3">
      <div className="flex shrink-0 flex-col items-center">
        <span
          className={cn(
            "inline-flex size-[34px] items-center justify-center rounded-full text-white",
            DOT_TONES[exchange.status] ?? "bg-muted-foreground",
          )}
        >
          <KindIcon className="size-[15px]" />
        </span>
        {!isLast && <span className="bg-border mt-1.5 w-0.5 flex-1" />}
      </div>
      <div className={cn("min-w-0 pt-px", !isLast && "pb-5")}>
        <div className="text-sm font-semibold">
          {primary}
          {secondary && (
            <span className="text-muted-foreground font-medium">
              {" "}
              ↔ {secondary}
            </span>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 mb-1.5 text-xs">
          {t("meta", {
            kind: t(`kind.${exchange.type}`),
            direction: t(
              incoming ? "direction.incoming" : "direction.outgoing",
            ),
            who,
          })}
        </div>
        <StatusPill status={exchange.status} />
      </div>
    </Link>
  );
}

function InMotionColumn({ exchanges }: { exchanges: ExchangeRow[] }) {
  const t = useTranslations("dashboard.pulse.inMotion");

  // Active exchanges first (the ones needing attention), then the rest,
  // newest activity first within each group; at most three.
  const sorted = [...exchanges].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(a.status) ? 0 : 1;
    const bActive = ACTIVE_STATUSES.has(b.status) ? 0 : 1;
    return aActive - bActive || b.updatedAt - a.updatedAt;
  });
  const shown = sorted.slice(0, 3);

  return (
    <section className="min-w-0">
      <SectionHead
        title={t("title")}
        icon={ArrowLeftRight}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/trades">{t("all")}</Link>
          </Button>
        }
      />
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="flex flex-col">
          {shown.map((exchange, i) => (
            <ExchangeTimelineRow
              key={exchange._id}
              exchange={exchange}
              isLast={i === shown.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- Goals */

// The SVG goal ring: a muted track with the brand-violet progress arc and the
// big percentage in the middle.
function GoalRing({
  current,
  target,
  size = 148,
}: {
  current: number;
  target: number;
  size?: number;
}) {
  const t = useTranslations("dashboard.pulse.goals");
  const stroke = 13;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = target > 0 ? Math.min(1, current / target) : 0;
  const mid = size / 2;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          stroke="var(--jigsaw-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`}
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-heading text-3xl leading-none font-bold">
          {Math.round(p * 100)}%
        </span>
        <span className="text-muted-foreground font-mono text-xs">
          {t("done", { current, target })}
        </span>
      </div>
    </div>
  );
}

function GoalBar({ goal }: { goal: GoalRow }) {
  const pct =
    goal.targetCompletions > 0
      ? Math.min(
          100,
          Math.round((goal.currentCompletions / goal.targetCompletions) * 100),
        )
      : 0;
  return (
    <Link href="/goals" className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2.5">
        <span className="truncate text-xs font-semibold">{goal.title}</span>
        <span className="text-muted-foreground font-mono text-xs whitespace-nowrap">
          {goal.currentCompletions}/{goal.targetCompletions}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-jigsaw-primary h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </Link>
  );
}

function GoalsColumn({ goals }: { goals: GoalRow[] }) {
  const t = useTranslations("dashboard.pulse.goals");
  const isMobile = useIsMobile();

  // Lead with the goal still being chased; fall back to any active goal,
  // then the newest one.
  const primary =
    goals.find((g) => g.isActive && !g.isAchieved) ??
    goals.find((g) => g.isActive) ??
    goals[0];
  const rest = goals.filter((g) => g !== primary).slice(0, 2);

  return (
    <section className="min-w-0">
      <SectionHead
        title={t("title")}
        icon={Target}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/goals">{t("all")}</Link>
          </Button>
        }
      />
      {!primary ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/goals">{t("setGoal")}</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4.5">
          <Link href="/goals">
            <GoalRing
              current={primary.currentCompletions}
              target={primary.targetCompletions}
              size={isMobile ? 116 : 148}
            />
          </Link>
          {rest.length > 0 && (
            <div className="flex flex-col gap-3 self-stretch">
              {rest.map((goal) => (
                <GoalBar key={goal._id} goal={goal} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- Latest */

function ActivityRow({
  entry,
  me,
  isLast,
}: {
  entry: ActivityEntry;
  me: Member;
  isLast: boolean;
}) {
  const t = useTranslations("dashboard.pulse.latest");
  const format = useFormatter();

  const isMe = entry.memberId === me._id;
  // The feed entry only carries the member id; resolve the display identity
  // here (Convex dedupes the subscription across rows for the same member).
  const other = useQuery(
    gateway.identity.byId,
    isMe ? "skip" : { userId: entry.memberId as Id<"users"> },
  );
  const actor = isMe ? me : other;

  if (actor === undefined) {
    return (
      <div className={cn("py-2.5", !isLast && "border-b")}>
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (actor === null) return null;

  return (
    <div className={cn("flex gap-3 py-2.5", !isLast && "border-b")}>
      <Avatar className="size-8">
        {actor.avatar && <AvatarImage src={actor.avatar} alt={actor.name} />}
        <AvatarFallback>{actor.name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="text-muted-foreground min-w-0 flex-1 text-sm leading-snug">
        {t.rich(entry.kind, {
          name: actor.name,
          strong: (chunks) => (
            <strong className="text-foreground">{chunks}</strong>
          ),
        })}
        <span className="mt-0.5 block text-xs">
          {format.relativeTime(entry.occurredAt)}
        </span>
      </div>
    </div>
  );
}

function LatestColumn({
  entries,
  me,
}: {
  entries: ActivityEntry[];
  me: Member;
}) {
  const t = useTranslations("dashboard.pulse.latest");
  const shown = entries.slice(0, 4);

  return (
    <section className="min-w-0">
      <SectionHead title={t("title")} icon={Bell} />
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="flex flex-col">
          {shown.map((entry, i) => (
            <ActivityRow
              key={`${entry.kind}-${entry.ref}-${entry.occurredAt}`}
              entry={entry}
              me={me}
              isLast={i === shown.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- Section */

function PulseSkeleton() {
  return (
    <div className="grid gap-6 lg:gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
    </div>
  );
}

// The three-column "pulse" of the briefing: exchange timeline, goal ring,
// and the community's latest activity — open columns on the ground, no cards.
export function PulseSection() {
  const { member, isMemberLoading } = useCurrentMember();

  const exchanges = useQuery(
    gateway.exchange.forUser,
    member?._id ? {} : "skip",
  );
  const goals = useQuery(gateway.solving.myGoals, member?._id ? {} : "skip");
  const feed = useQuery(
    gateway.social.activityFeed,
    member?._id ? { limit: 8 } : "skip",
  );

  const loading =
    isMemberLoading ||
    (member != null &&
      (exchanges === undefined || goals === undefined || feed === undefined));

  if (loading) return <PulseSkeleton />;
  if (!member) return null;

  return (
    <div className="grid gap-6 lg:gap-10 lg:grid-cols-[1.15fr_0.85fr_1.1fr]">
      <InMotionColumn exchanges={exchanges ?? []} />
      <GoalsColumn goals={goals ?? []} />
      <LatestColumn entries={feed ?? []} me={member} />
    </div>
  );
}
