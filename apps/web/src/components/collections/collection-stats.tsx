// Open, card-free stats surface for the collection detail hero: a divided row of
// big-number/muted-label cells plus a "Difficulty Mix" segmented bar. Stats are
// derived from the collection's member copies (piece counts, difficulty tiers,
// trade availability) by `computeCollectionStats`.

import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";

// The member-copy shape `collections.byId` returns — derived from the gateway so
// this helper never imports `@jigswap/contracts` directly (the app reads its
// types through the gateway edge, mirroring PuzzleCard).
type CollectionPuzzle = NonNullable<
  FunctionReturnType<typeof gateway.collections.byId>
>["puzzles"][number];

export type DifficultyTier = "easy" | "medium" | "hard" | "expert";

const TIER_ORDER: DifficultyTier[] = ["easy", "medium", "hard", "expert"];
const TIER_VALUE: Record<DifficultyTier, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
  expert: 4,
};

export type CollectionStats = {
  puzzleCount: number;
  piecesTotal: number;
  /** Average tier label (`easy|medium|hard|expert`) or null when no puzzle declares one. */
  avgDifficulty: DifficultyTier | null;
  upForTrade: number;
  /** Member counts per tier (puzzles without a declared difficulty are excluded). */
  difficultyMix: Record<DifficultyTier, number>;
};

/** Resolve a copy's piece count, falling back to its catalog snapshot. */
function pieceCountOf(copy: CollectionPuzzle): number {
  return copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount ?? 0;
}

export function computeCollectionStats(
  puzzles: CollectionPuzzle[],
): CollectionStats {
  const difficultyMix: Record<DifficultyTier, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
    expert: 0,
  };

  let piecesTotal = 0;
  let upForTrade = 0;
  let difficultySum = 0;
  let difficultyCount = 0;

  for (const copy of puzzles) {
    piecesTotal += pieceCountOf(copy);
    if (copy.availability.forTrade) upForTrade += 1;

    const tier = copy.puzzle?.difficulty;
    if (tier) {
      difficultyMix[tier] += 1;
      difficultySum += TIER_VALUE[tier];
      difficultyCount += 1;
    }
  }

  const avgDifficulty: DifficultyTier | null =
    difficultyCount > 0
      ? TIER_ORDER[Math.round(difficultySum / difficultyCount) - 1]
      : null;

  return {
    puzzleCount: puzzles.length,
    piecesTotal,
    avgDifficulty,
    upForTrade,
    difficultyMix,
  };
}

type StatCell = { value: string; label: string };

/** Open, divided row of big-number-over-muted-label stat cells. */
export function StatsBar({
  cells,
  children,
}: {
  cells: StatCell[];
  /** Trailing content (e.g. the difficulty mix), pushed to the far right. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <dl className="flex flex-1 flex-wrap items-stretch divide-x divide-border">
        {cells.map((cell) => (
          <div key={cell.label} className="px-5 first:pl-0">
            <dd className="font-heading text-2xl font-bold tracking-tight">
              {cell.value}
            </dd>
            <dt className="text-xs text-muted-foreground">{cell.label}</dt>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}

// Brand/status hues for the difficulty tiers — green easy, amber medium/hard,
// red expert — matching the stat bar's open, color-led language.
const TIER_BAR: Record<DifficultyTier, string> = {
  easy: "bg-jigsaw-success",
  medium: "bg-jigsaw-warning",
  hard: "bg-jigsaw-warning",
  expert: "bg-destructive",
};

/** A slim segmented bar + legend showing the proportion of difficulty tiers. */
export function DifficultyMix({
  label,
  mix,
  tierLabels,
}: {
  label: string;
  mix: Record<DifficultyTier, number>;
  tierLabels: Record<DifficultyTier, string>;
}) {
  const total = TIER_ORDER.reduce((sum, tier) => sum + mix[tier], 0);
  if (total === 0) return null;

  const segments = TIER_ORDER.filter((tier) => mix[tier] > 0);

  return (
    <div className="min-w-[12rem]">
      <div className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {segments.map((tier) => (
          <div
            key={tier}
            className={cn(TIER_BAR[tier])}
            style={{ width: `${(mix[tier] / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {segments.map((tier) => (
          <span key={tier} className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", TIER_BAR[tier])} />
            {tierLabels[tier]} · {mix[tier]}
          </span>
        ))}
      </div>
    </div>
  );
}
