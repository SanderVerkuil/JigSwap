// Shared aggregate helpers over a puzzle DEFINITION, used by BOTH the auth-gated member detail
// (getPuzzleDefinitionView) and the unauthenticated public catalog reads. Moved verbatim from
// getPuzzleDefinitionView.ts so the two views can't drift on the shared math.

import type { CopyOfferSwapType } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";

const MS_PER_DAY = 86_400_000;

/** Round to 1 decimal place. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Whole-day solve duration: the stored, explicit `completionTimeMinutes` ALWAYS wins (it's the
 * domain's resolved duration — mirrors `Completion.resolveDuration`, which already picked
 * explicit-vs-derived and applies the same-day => 1 day floor), converted to whole days. The
 * (endDate - startDate) diff is only a FALLBACK for legacy rows that predate persisting a duration.
 * A non-positive fallback result means the span is unusable as a duration (e.g. a legacy same-day
 * row) and returns null (unknown) rather than a misleading 0. Null when neither is recorded. */
export const finishDaysOf = (c: {
  startDate: number;
  endDate?: number;
  completionTimeMinutes?: number;
}): number | null => {
  if (c.completionTimeMinutes != null) {
    return Math.round(c.completionTimeMinutes / 1440);
  }
  if (c.endDate != null) {
    const days = Math.round((c.endDate - c.startDate) / MS_PER_DAY);
    return days > 0 ? days : null;
  }
  return null;
};

/** A copy is "open" iff at least one exchange-availability flag is set (identical to browseOwnedPuzzles). */
export const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

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

/** Community rating distribution over DEFINITION-level reviews (puzzleComments with a rating and
 * copyId == null). breakdown index 0..4 == [5★..1★]. */
export const ratingBreakdownOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<RatingBreakdown> => {
  const comments = await ctx.db
    .query("puzzleComments")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .collect();
  const ratedReviews = comments.filter(
    (c) => c.rating != null && c.copyId == null,
  );
  const breakdown: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let ratingSum = 0;
  for (const c of ratedReviews) {
    const r = c.rating as number;
    ratingSum += r;
    const bucket = 5 - r; // r=5 -> 0, r=1 -> 4
    if (bucket >= 0 && bucket <= 4) breakdown[bucket] += 1;
  }
  const ratingCount = ratedReviews.length;
  const pct = (n: number): number =>
    ratingCount > 0 ? Math.round((n / ratingCount) * 100) : 0;
  return {
    rating: ratingCount > 0 ? round1(ratingSum / ratingCount) : 0,
    count: ratingCount,
    breakdown,
    percentages: [
      pct(breakdown[0]),
      pct(breakdown[1]),
      pct(breakdown[2]),
      pct(breakdown[3]),
      pct(breakdown[4]),
    ],
  };
};

/** Completion aggregate for a definition: count of finished solves + average whole-day duration.
 * A solve is recorded against the definition (puzzleId) OR against a copy (ownedPuzzleId only);
 * both are counted, deduped by _id. `ownedCopies` is the definition's ownedPuzzles rows (the caller
 * already has them). */
export const completionStatsOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
  ownedCopies: Doc<"ownedPuzzles">[],
): Promise<{ totalCompletions: number; avgCompletionDays: number | null }> => {
  const byDefinition = await ctx.db
    .query("completions")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .collect();
  const byCopy = (
    await Promise.all(
      ownedCopies.map((copy) =>
        ctx.db
          .query("completions")
          .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy._id))
          .collect(),
      ),
    )
  ).flat();
  const deduped = new Map<string, (typeof byDefinition)[number]>();
  for (const c of [...byDefinition, ...byCopy]) {
    deduped.set(c._id as unknown as string, c);
  }
  const completed = [...deduped.values()].filter((c) => c.isCompleted);
  const finishDaysList = completed
    .map(finishDaysOf)
    .filter((d): d is number => d != null);
  return {
    totalCompletions: completed.length,
    avgCompletionDays:
      finishDaysList.length > 0
        ? round1(
            finishDaysList.reduce((s, d) => s + d, 0) / finishDaysList.length,
          )
        : null,
  };
};

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
): Promise<{
  total: number;
  byType: { swap: number; lend: number; sale: number };
}> => {
  const ownerIsPublic = async (ownerId: Id<"users">): Promise<boolean> => {
    const key = ownerId as unknown as string;
    let cached = visibilityCache.get(key);
    if (cached === undefined) {
      cached = await profileVisibilityOf(ctx, ownerId);
      visibilityCache.set(key, cached);
    }
    return cached === "public";
  };
  const byType = { swap: 0, lend: 0, sale: 0 };
  for (const copy of ownedCopies.filter(isOpen)) {
    if (await ownerIsPublic(copy.ownerId)) {
      byType[swapTypeOf(copy)] += 1;
    }
  }
  return { total: byType.swap + byType.lend + byType.sale, byType };
};
