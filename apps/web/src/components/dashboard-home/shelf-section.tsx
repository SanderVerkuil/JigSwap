"use client";

import { Link } from "@/compat/link";
import { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import { PuzzlePlank3D } from "@/components/common/puzzle-plank-3d";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { BookOpen, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
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
// share one library.myShelf subscription; the plank shows the first PLANK_SIZE of them.
export const MY_SHELF_SIZE = 6;
const PLANK_SIZE = 5;

// Warm gradient pairs for boxes without cover art (violet / green / pink /
// amber brand hues) — never an empty gray box.
const BOX_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#6048e8", "#494e92"],
  ["#3fae3c", "#157a13"],
  ["#ec4899", "#b22d6e"],
  ["#f5a623", "#cf7911"],
];

// Varied box heights so the shelf reads like a real, lived-in collection.
const BOX_HEIGHTS = [148, 130, 156, 126, 142];

// Shorter set for the cramped mobile dashboard (see sub-project ②).
const MOBILE_BOX_HEIGHTS = [118, 104, 124, 100, 114];

function toPlankBox(
  copy: OwnedCopy,
  index: number,
  isMobile: boolean,
): PuzzlePlankBox {
  // Prefer the copy's resolved cover (a user-uploaded/pinned photo) over the
  // catalogue image so a copy with its own cover shows it, not placeholder art.
  const cover = copy.coverUrl ?? copy.puzzle?.images?.[0];
  const [c1, c2] = BOX_GRADIENTS[index % BOX_GRADIENTS.length];
  const heights = isMobile ? MOBILE_BOX_HEIGHTS : BOX_HEIGHTS;
  return {
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    series: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover,
    c1,
    c2,
    // Narrower boxes on mobile; PuzzlePlank derives cover-box height from width,
    // so this shortens the whole shelf. Desktop keeps the component default (116).
    width: isMobile ? 92 : undefined,
    height: cover ? undefined : heights[index % heights.length],
  };
}

function StatRow({
  href,
  value,
  label,
  sub,
}: {
  href: string;
  value: string | number;
  label: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3.5 border-t py-3 first:border-t-0"
    >
      <span className="font-heading min-w-[52px] text-2xl leading-none font-bold">
        {value}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground mt-px block text-xs">{sub}</span>
      </span>
      <ChevronRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
    </Link>
  );
}

// "Your Shelf": the signature puzzle plank rendering the member's real copies,
// with the four key numbers as a divided rail beside it — open rows on the
// ground, no stat cards.
export function ShelfSection() {
  const t = useTranslations("dashboard.shelf");
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
    convexQuery(gateway.exchange.forUser, member?._id ? {} : "skip"),
  );

  // Memoized so the 3D plank's color-resolution effect doesn't re-run on every
  // reactive re-render of this dashboard (only when the copies/viewport change).
  const plankBoxes = useMemo(
    () =>
      (shelf?.recent ?? [])
        .slice(0, PLANK_SIZE)
        .map((copy, i) => toPlankBox(copy, i, isMobile)),
    [shelf, isMobile],
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
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_252px]">
          <Skeleton className="h-44 w-full" />
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
  const activeExchanges = (exchanges ?? []).filter(
    (e) =>
      e.status === "proposed" ||
      e.status === "accepted" ||
      e.status === "disputed",
  ).length;

  const statRows = [
    {
      href: "/my-puzzles",
      value: owned,
      label: t("stats.ownedLabel"),
      sub: t("stats.ownedSub", { count: forTrade }),
    },
    {
      href: "/trades",
      value: stats?.tradesCompleted ?? 0,
      label: t("stats.completedLabel"),
      sub: t("stats.completedSub"),
    },
    {
      href: "/people",
      value: stats?.averageRating ? stats.averageRating.toFixed(1) : "—",
      label: t("stats.ratingLabel"),
      sub: t("stats.ratingSub", { count: stats?.totalReviews ?? 0 }),
    },
    {
      href: "/trades",
      value: activeExchanges,
      label: t("stats.activeLabel"),
      sub: t("stats.activeSub"),
    },
  ];

  return (
    <section data-tour="dashboard-shelf">
      <SectionHead
        title={t("title")}
        icon={BookOpen}
        headingProps={SHELF_HEADING_PROPS}
        meta={owned > 0 ? t("meta", { owned, forTrade }) : undefined}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/collections">{t("viewCollections")}</Link>
          </Button>
        }
      />
      {owned === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-muted-foreground max-w-md text-sm">{t("empty")}</p>
          <Button asChild>
            <Link href="/my-puzzles/add">{t("addFirst")}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_252px]">
          <div className="h-[300px] min-w-0 md:h-[360px]">
            <PuzzlePlank3D boxes={plankBoxes} />
          </div>
          <div className="flex flex-col">
            {statRows.map((row) => (
              <StatRow key={row.label} {...row} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
