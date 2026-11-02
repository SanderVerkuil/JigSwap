// Shared aggregate helpers over a puzzle DEFINITION, used by BOTH the auth-gated member detail
// (getPuzzleDefinitionView) and the unauthenticated public catalog reads. Moved verbatim from
// getPuzzleDefinitionView.ts so the two views can't drift on the shared math.

import type { CopyOfferSwapType } from "@jigswap/contracts";
import { isPlausibleSolveMinutes, MAX_SOLVE_MINUTES } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { profileVisibilityOf } from "../social/privacy";
import { isCopyPrivate } from "./copyVisibility";
import { isOpenAvailability } from "./openListing";

const MS_PER_DAY = 86_400_000;

/** Round to 1 decimal place. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The longest solve an average counts, in days: MAX_SOLVE_MINUTES. */
const MAX_FINISH_DAYS = MAX_SOLVE_MINUTES / 1440;

/** Whole-day solve duration: the stored, explicit `completionTimeMinutes` ALWAYS wins (it's the
 * domain's resolved duration — mirrors `Completion.resolveDuration`, which already picked
 * explicit-vs-derived and applies the same-day => 1 day floor), converted to whole days. The
 * (endDate - startDate) diff is only a FALLBACK for legacy rows that predate persisting a duration,
 * and for dates too far apart to have a duration. A fallback result that isn't positive means the
 * span is unusable as a duration (e.g. a legacy same-day row) and returns null (unknown) rather than
 * a misleading 0. So does a number no solve can have taken, stored before the domain bounded it:
 * one row must not swamp a definition's public average. Null when neither is recorded. */
export const finishDaysOf = (c: {
  startDate: number;
  endDate?: number;
  completionTimeMinutes?: number;
}): number | null => {
  if (c.completionTimeMinutes != null) {
    return isPlausibleSolveMinutes(c.completionTimeMinutes)
      ? Math.round(c.completionTimeMinutes / 1440)
      : null;
  }
  if (c.endDate != null) {
    const days = Math.round((c.endDate - c.startDate) / MS_PER_DAY);
    return days > 0 && days <= MAX_FINISH_DAYS ? days : null;
  }
  return null;
};

/** A copy is "open" iff at least one exchange-availability flag is set (library/openListing). */
export const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  isOpenAvailability(copy.availability);

/** Distinct owners of a definition's copies, counting a PRIVATE copy (library/copyVisibility) only
 * when `seesPrivateOf(ownerId)` — the viewer is that owner or in their household. The unauthenticated
 * public reads pass nothing, so private copies never count there. */
export const communityOwnersOf = (
  ownedCopies: Doc<"ownedPuzzles">[],
  seesPrivateOf: (ownerId: Id<"users">) => boolean = () => false,
): number =>
  new Set(
    ownedCopies
      .filter((c) => !isCopyPrivate(c) || seesPrivateOf(c.ownerId))
      .map((c) => c.ownerId as unknown as string),
  ).size;

/** Availability priority -> swapType: forTrade -> "swap", forLend -> "lend", forSale -> "sale". */
export const swapTypeOf = (copy: Doc<"ownedPuzzles">): CopyOfferSwapType => {
  if (copy.availability.forTrade) return "swap";
  if (copy.availability.forLend) return "lend";
  return "sale";
};

/** The adminCategories name is localized `{ en, nl }`; the detail pages want a single string (English).
 * Defensive against legacy/raw string shapes. */
export const categoryNameOf = (
  row: Doc<"adminCategories"> | null,
): string | undefined => {
  if (!row) return undefined;
  const name = row.name as unknown;
  if (typeof name === "string") return name;
  if (name && typeof name === "object" && "en" in name) {
    const en = (name as { en?: unknown }).en;
    if (typeof en === "string") return en;
  }
  return undefined;
};

export interface RatingBreakdown {
  rating: number;
  count: number;
  breakdown: [number, number, number, number, number];
  percentages: [number, number, number, number, number];
}

/** The sums a RatingBreakdown is derived from (stored as is in library/definitionStats).
 * breakdown index 0..4 == [5★..1★]. */
export interface RatingTotals {
  ratingCount: number;
  ratingSum: number;
  breakdown: [number, number, number, number, number];
}

/** Community rating sums over the definition's `puzzleReviews` rows (one per member). Migrated
 * text-only rows (rating undefined) never aggregate. */
export const ratingTotalsOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<RatingTotals> => {
  const reviews = await ctx.db
    .query("puzzleReviews")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .collect();
  const ratedReviews = reviews.filter((c) => c.rating != null);
  const breakdown: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let ratingSum = 0;
  for (const c of ratedReviews) {
    const r = c.rating as number;
    ratingSum += r;
    const bucket = 5 - r; // r=5 -> 0, r=1 -> 4
    if (bucket >= 0 && bucket <= 4) breakdown[bucket] += 1;
  }
  return { ratingCount: ratedReviews.length, ratingSum, breakdown };
};

/** The community rating distribution shown on the definition pages, from its sums. */
export const ratingBreakdownFromTotals = ({
  ratingCount,
  ratingSum,
  breakdown,
}: RatingTotals): RatingBreakdown => {
  const pct = (n: number): number =>
    ratingCount > 0 ? Math.round((n / ratingCount) * 100) : 0;
  return {
    rating: ratingCount > 0 ? round1(ratingSum / ratingCount) : 0,
    count: ratingCount,
    breakdown: [...breakdown],
    percentages: [
      pct(breakdown[0]),
      pct(breakdown[1]),
      pct(breakdown[2]),
      pct(breakdown[3]),
      pct(breakdown[4]),
    ],
  };
};

/** Community rating distribution over the definition's `puzzleReviews` rows, read live. */
export const ratingBreakdownOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<RatingBreakdown> =>
  ratingBreakdownFromTotals(await ratingTotalsOf(ctx, puzzleId));

/** The sums the completion stats are derived from (stored as is in library/definitionStats). */
export interface CompletionTotals {
  completedCount: number;
  finishDaysSum: number;
  finishDaysCount: number;
}

// How many solves stored against a copy alone (no `puzzleId`) one read looks through. Only rows from
// before solves got their definition link are like that: every write since sets it, and
// solving/backfillCompletionPuzzleId gives the old ones theirs, leaving only those whose copy is gone.
// So this holds few rows once that has run; past the bound the totals undercount, and say so.
export const COPY_ONLY_SOLVES_READ = 1000;

/** Completion sums for a definition: finished solves, and the whole-day durations of those that
 * have one. A solve is recorded against the definition (puzzleId) OR, on an old row, only against a
 * copy (ownedPuzzleId); both are counted. `ownedCopies` is the definition's ownedPuzzles rows (the
 * caller already has them). Costs two index ranges however many copies there are: a definition can
 * have more copies than a function may read index ranges. */
export const completionTotalsOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
  ownedCopies: Doc<"ownedPuzzles">[],
): Promise<CompletionTotals> => {
  const byDefinition = await ctx.db
    .query("completions")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .collect();
  const copyOnly = await ctx.db
    .query("completions")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", undefined))
    .take(COPY_ONLY_SOLVES_READ + 1);
  if (copyOnly.length > COPY_ONLY_SOLVES_READ) {
    logEvent({
      event: "library.definitionStats.copyOnlySolvesCapped",
      outcome: "error",
      puzzle_id: puzzleId,
      read: COPY_ONLY_SOLVES_READ,
    });
  }
  const copies = new Set<Id<"ownedPuzzles">>(ownedCopies.map((c) => c._id));
  const solves = [
    ...byDefinition,
    ...copyOnly
      .slice(0, COPY_ONLY_SOLVES_READ)
      .filter((c) => c.ownedPuzzleId && copies.has(c.ownedPuzzleId)),
  ];
  const completed = solves.filter((c) => c.isCompleted);
  const finishDaysList = completed
    .map(finishDaysOf)
    .filter((d): d is number => d != null);
  return {
    completedCount: completed.length,
    finishDaysSum: finishDaysList.reduce((s, d) => s + d, 0),
    finishDaysCount: finishDaysList.length,
  };
};

/** Completion aggregate shown on the definition pages (count of finished solves + average
 * whole-day duration), from its sums. Stored sums that average past any solve were written before
 * finishDaysOf left such rows out: unknown until the row's next recompute (nightly at the latest). */
export const completionStatsFromTotals = ({
  completedCount,
  finishDaysSum,
  finishDaysCount,
}: CompletionTotals): {
  totalCompletions: number;
  avgCompletionDays: number | null;
} => {
  const average = finishDaysCount > 0 ? finishDaysSum / finishDaysCount : null;
  return {
    totalCompletions: completedCount,
    avgCompletionDays:
      average !== null && average <= MAX_FINISH_DAYS ? round1(average) : null,
  };
};

/** Completion aggregate for a definition, read live. */
export const completionStatsOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
  ownedCopies: Doc<"ownedPuzzles">[],
): Promise<{ totalCompletions: number; avgCompletionDays: number | null }> =>
  completionStatsFromTotals(
    await completionTotalsOf(ctx, puzzleId, ownedCopies),
  );

export interface PublicAvailability {
  total: number;
  byType: { swap: number; lend: number; sale: number };
}

/** The public availability aggregate from its per-type counts (stored as is in
 * library/definitionStats). */
export const publicAvailabilityFromByType = (
  byType: PublicAvailability["byType"],
): PublicAvailability => ({
  total: byType.swap + byType.lend + byType.sale,
  byType: { ...byType },
});

/** PUBLIC availability aggregate: open copies whose owner's profile is PUBLIC, each counted once
 * under its priority swap type. No circle reachability and no viewer exclusion — there is no
 * viewer. This count is intentionally NOT equal to the member-facing stats.availableToSwap (which
 * adds circle-shared copies and excludes the viewer's own copies); the asymmetry is by design per
 * the Phase 5 spec — do not "fix" it. Pass a shared `visibilityCache` when aggregating many
 * definitions in one request (the list page) so each owner is resolved once. */
export const publicAvailabilityOf = async (
  ctx: QueryCtx,
  ownedCopies: Doc<"ownedPuzzles">[],
  visibilityCache: Map<string, "public" | "private"> = new Map(),
): Promise<PublicAvailability> => {
  const ownerIsPublic = async (copy: Doc<"ownedPuzzles">): Promise<boolean> => {
    // A row with its listing fields says so itself (a profile change re-stamps them and then marks
    // the definition, library/ownerListingVisibility), so a definition with thousands of owners
    // costs no read per owner. Only a row from before those fields needs the lookup.
    if (copy.isOpen !== undefined) return copy.ownerPrivate !== true;
    const key = copy.ownerId as unknown as string;
    let cached = visibilityCache.get(key);
    if (cached === undefined) {
      cached = await profileVisibilityOf(ctx, copy.ownerId);
      visibilityCache.set(key, cached);
    }
    return cached === "public";
  };
  const byType = { swap: 0, lend: 0, sale: 0 };
  for (const copy of ownedCopies.filter(isOpen)) {
    if (await ownerIsPublic(copy)) {
      byType[swapTypeOf(copy)] += 1;
    }
  }
  return publicAvailabilityFromByType(byType);
};
