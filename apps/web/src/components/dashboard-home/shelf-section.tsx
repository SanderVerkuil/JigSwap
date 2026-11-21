"use client";

import { Link } from "@/compat/link";
import { copyShelfBox } from "@/components/shelf/copy-box";
import { Shelf, ShelfLedge } from "@/components/shelf/shelf";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { LIVE_EXCHANGES_PER_READ } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { BookOpen, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { SectionHead } from "./section-head";
import { useCurrentMember } from "./use-current-member";

// The Shelf heading takes focus when the quick setup card above it is hidden (spec §5.7).
export const SHELF_HEADING_ID = "dashboard-shelf-heading";
const SHELF_HEADING_PROPS = {
  id: SHELF_HEADING_ID,
  tabIndex: -1,
  className: "focus-visible:outline-none",
};

type OwnedCopy = FunctionReturnType<
  typeof gateway.library.myShelf
>["recent"][number];

// How many copies the dashboard shelf reads: the Fresh section below shows six, so both sections
// share one library.myShelf subscription; the shelf shows the first SHELF_BOX_COUNT of them.
export const MY_SHELF_SIZE = 6;

// Boxes on the shelf. The boxes share the row's width, so a phone shows fewer to keep the covers
// big enough to recognise.
const SHELF_BOX_COUNT = 5;
const PHONE_SHELF_BOX_COUNT = 3;

// How many copies the shelf shows on this device (useIsMobile()). Fresh on the
// Shelf compares against it, so it only appears once it adds something.
export function shelfBoxCount(isMobile: boolean): number {
  return isMobile ? PHONE_SHELF_BOX_COUNT : SHELF_BOX_COUNT;
}

type StatKey = "owned" | "completed" | "rating" | "active";

// Which stat rows to show. Exchanges completed, rating and active exchanges
// stay hidden while all three are still zero (a new member would read three
// zeros and a dash); once any of them counts, all four show.
export function statRowsFor({
  tradesCompleted,
  totalReviews,
  activeExchanges,
}: {
  tradesCompleted: number;
  totalReviews: number;
  activeExchanges: number;
}): StatKey[] {
  return tradesCompleted > 0 || totalReviews > 0 || activeExchanges > 0
    ? ["owned", "completed", "rating", "active"]
    : ["owned"];
}

// A copy on the member's own shelf opens as theirs (My Puzzles › the copy).
const toShelfBox = (copy: OwnedCopy) =>
  copyShelfBox(copy, `/my-puzzles/${copy._id}`);

function StatRow({
  href,
  hash,
  value,
  label,
  sub,
}: {
  href: string;
  hash?: string;
  value: string | number;
  label: string;
  sub: string;
}) {
  return (
    <RouterLink
      to={href}
      hash={hash}
      className="group flex items-center gap-2.5 border-t py-3 sm:gap-3.5 xl:first:border-t-0"
    >
      <span className="min-w-9 font-sans text-xl leading-none font-semibold tabular-nums sm:min-w-[52px] sm:text-2xl">
        {value}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground mt-px block text-xs">{sub}</span>
      </span>
      <ChevronRight className="text-muted-foreground group-hover:text-foreground hidden size-4 shrink-0 transition-colors sm:block" />
    </RouterLink>
  );
}

// "Your Shelf": the member's newest boxes on the shelf (components/shelf), with the four key
// numbers as a divided rail beside it from xl, standing level with the ledge — open rows on the
// ground, no stat cards. Narrower, the rows sit under the shelf as a compact 2×2 grid.
export function ShelfSection() {
  const t = useTranslations("dashboard.shelf");
  const format = useFormatter();
  const isMobile = useIsMobile();
  const { member, isMemberLoading } = useCurrentMember();

  // The member's own shelf summary: counts over the whole library, but only the newest copies
  // joined (never the whole joined library just to draw a few boxes).
  const { data: shelf } = useQuery(
    convexQuery(
      gateway.library.myShelf,
      member?._id ? { limit: MY_SHELF_SIZE } : "skip",
    ),
  );
  const { data: stats } = useQuery(
    convexQuery(
      gateway.identity.userStats,
      member?._id ? { userId: member._id as Id<"users"> } : "skip",
    ),
  );
  const { data: exchanges } = useQuery(
    convexQuery(gateway.exchange.myLive, member?._id ? {} : "skip"),
  );

  const loading =
    isMemberLoading ||
    (member != null &&
      (shelf === undefined || stats === undefined || exchanges === undefined));

  if (loading) {
    return (
      <section data-tour="dashboard-shelf">
        <SectionHead
          title={t("title")}
          icon={BookOpen}
          headingProps={SHELF_HEADING_PROPS}
        />
        <div className="grid gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,1fr)_252px] xl:items-end">
          <div>
            <div className="flex h-32 items-end gap-3.5">
              {[0.8, 1, 0.9].map((h, i) => (
                <Skeleton
                  key={i}
                  className="w-28 rounded-none rounded-t-[2px]"
                  style={{ height: `${h * 6}rem` }}
                />
              ))}
            </div>
            <ShelfLedge />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const owned = shelf?.total ?? 0;
  const forTrade = shelf?.forTrade ?? 0;
  const activeExchanges = (exchanges ?? []).length;

  const tradesCompleted = stats?.tradesCompleted ?? 0;
  const totalReviews = stats?.totalReviews ?? 0;
  const allStatRows = {
    owned: {
      href: "/my-puzzles",
      value: owned,
      label: t("stats.ownedLabel"),
      sub: t("stats.ownedSub", { count: forTrade }),
    },
    completed: {
      href: "/trades",
      value: tradesCompleted,
      label: t("stats.completedLabel"),
      sub: t("stats.completedSub"),
    },
    // Your own reviews: the `reviews` anchor of ReputationSection on /profile.
    rating: {
      href: "/profile",
      hash: "reviews",
      value: stats?.averageRating
        ? format.number(stats.averageRating, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })
        : "—",
      label: t("stats.ratingLabel"),
      sub: t("stats.ratingSub", { count: totalReviews }),
    },
    active: {
      href: "/trades",
      // One read holds a window of what's in play: a full one may have more behind it.
      value:
        activeExchanges >= LIVE_EXCHANGES_PER_READ
          ? `${activeExchanges}+`
          : activeExchanges,
      label: t("stats.activeLabel"),
      sub: t("stats.activeSub"),
    },
  };
  const statRows = statRowsFor({
    tradesCompleted,
    totalReviews,
    activeExchanges,
  }).map((key) => allStatRows[key]);

  return (
    <section data-tour="dashboard-shelf">
      <SectionHead
        title={t("title")}
        icon={BookOpen}
        headingProps={SHELF_HEADING_PROPS}
        meta={
          // Phones drop the meta: it would truncate beside the title and the
          // owned stat row below repeats both numbers. So does every width
          // while that row is the only one, standing right under it.
          owned > 0 && statRows.length > 1 ? (
            <span className="hidden sm:inline">
              {t("meta", { owned, forTrade })}
            </span>
          ) : undefined
        }
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/my-puzzles">{t("allPuzzles")}</Link>
          </Button>
        }
      />
      {owned === 0 ? (
        // The empty shelf: the invitation stands where the boxes will.
        <div>
          <div className="flex flex-col items-start gap-3 pt-2 pb-5">
            <p className="text-muted-foreground max-w-md text-sm">
              {t("empty")}
            </p>
            <Button asChild>
              <Link href="/my-puzzles/add">{t("addFirst")}</Link>
            </Button>
          </div>
          <ShelfLedge />
        </div>
      ) : (
        <div className="grid gap-x-10 gap-y-4 xl:grid-cols-[minmax(0,1fr)_252px] xl:items-end">
          <Shelf
            boxes={(shelf?.recent ?? [])
              .slice(0, shelfBoxCount(isMobile))
              .map(toShelfBox)}
            label={t("title")}
            className="min-w-0"
          />
          <div
            data-testid="shelf-stats"
            className={cn(
              "grid xl:flex xl:flex-col",
              statRows.length > 1 && "grid-cols-2 gap-x-4 sm:gap-x-8",
            )}
          >
            {statRows.map((row) => (
              <StatRow key={row.label} {...row} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
