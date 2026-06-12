"use client";

import { Link } from "@/compat/link";
import { PuzzlePlank, PuzzlePlankBox } from "@/components/common/puzzle-plank";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BookOpen, ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { SectionHead } from "./section-head";
import { useCurrentMember } from "./use-current-member";

type OwnedCopy = FunctionReturnType<
  typeof gateway.library.ownedByOwner
>[number];

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

function toPlankBox(copy: OwnedCopy, index: number): PuzzlePlankBox {
  const cover = copy.puzzle?.images?.[0] ?? copy.snapshot?.thumbnail;
  const [c1, c2] = BOX_GRADIENTS[index % BOX_GRADIENTS.length];
  return {
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    series: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    cover,
    c1,
    c2,
    height: cover ? undefined : BOX_HEIGHTS[index % BOX_HEIGHTS.length],
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
  const { member, isMemberLoading } = useCurrentMember();

  const copies = useQuery(
    gateway.library.ownedByOwner,
    member?._id
      ? { ownerId: member._id as Id<"users">, includeUnavailable: true }
      : "skip",
  );
  const stats = useQuery(
    gateway.identity.userStats,
    member?._id ? { userId: member._id as Id<"users"> } : "skip",
  );
  const exchanges = useQuery(
    gateway.exchange.forUser,
    member?._id ? { userId: member._id as Id<"users"> } : "skip",
  );

  const loading =
    isMemberLoading ||
    (member != null &&
      (copies === undefined || stats === undefined || exchanges === undefined));

  if (loading) {
    return (
      <section>
        <SectionHead title={t("title")} icon={BookOpen} />
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

  const owned = copies ?? [];
  const forTrade = owned.filter((c) => c.availability.forTrade).length;
  const activeExchanges = (exchanges ?? []).filter(
    (e) =>
      e.status === "proposed" ||
      e.status === "accepted" ||
      e.status === "disputed",
  ).length;

  const statRows = [
    {
      href: "/my-puzzles",
      value: owned.length,
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
      href: "/community",
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
    <section>
      <SectionHead
        title={t("title")}
        icon={BookOpen}
        meta={
          owned.length > 0
            ? t("meta", { owned: owned.length, forTrade })
            : undefined
        }
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/collections">{t("viewCollections")}</Link>
          </Button>
        }
      />
      {owned.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-muted-foreground max-w-md text-sm">{t("empty")}</p>
          <Button asChild>
            <Link href="/my-puzzles/add">{t("addFirst")}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_252px]">
          <div className="overflow-x-auto px-2 pt-6 pb-5">
            <PuzzlePlank boxes={owned.slice(0, 5).map(toPlankBox)} />
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
