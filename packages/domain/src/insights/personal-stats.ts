// Insights is a read-side context: these are pure, total projection functions over plain input
// DTOs (no Convex imports). The Convex adapter fetches rows, maps them to these inputs, and applies
// the function. Keeping the maths here makes it deterministic and unit-testable in isolation.

// One completed solve, reduced to what the stats need.
export interface CompletionStatInput {
  readonly completionTimeMinutes?: number;
  readonly isCompleted: boolean;
}

// One owned copy, reduced to its catalog snapshot facets used for counting/distribution.
export interface CopyStatInput {
  // The catalog definition this copy instantiates; distinct definitions are counted from these.
  readonly puzzleDefinitionKey?: string;
}

// One exchange the member took part in, reduced to its lifecycle status.
export type ExchangeStatStatus =
  "proposed" | "accepted" | "completed" | "rejected" | "cancelled" | "disputed";

export interface ExchangeStatInput {
  readonly status: ExchangeStatStatus;
}

// One PartnerReview rating received by the member (1-5).
export interface ReceivedReviewStatInput {
  readonly rating: number;
}

// One goal, reduced to the flags the stats summarise.
export interface GoalStatInput {
  readonly isActive: boolean;
  readonly targetCompletions: number;
  readonly currentCompletions: number;
}

export interface PersonalStatsInput {
  readonly completions: readonly CompletionStatInput[];
  readonly copies: readonly CopyStatInput[];
  readonly collectionsCount: number;
  readonly exchanges: readonly ExchangeStatInput[];
  // The 1-5 ratings from the member's puzzle reviews (the two-level review model's
  // `puzzleReviews` rows), no longer attached to completions.
  readonly puzzleReviewRatings: readonly number[];
  readonly reviewsReceived: readonly ReceivedReviewStatInput[];
  readonly goals: readonly GoalStatInput[];
}

export interface PersonalStats {
  readonly completionsCount: number;
  readonly totalSolveMinutes: number;
  readonly averageSolveMinutes: number;
  readonly puzzlesOwned: number;
  readonly distinctDefinitions: number;
  readonly collectionsCount: number;
  readonly exchangesCompleted: number;
  // null when the member has no puzzle reviews (distinguishes "no reviews" from a 0 average).
  readonly averageRatingGiven: number | null;
  readonly averageRatingReceived: number;
  readonly goalsActive: number;
  readonly goalsAchieved: number;
}

// Mean of the present numeric values; empty input is 0 (not NaN) so the read model is total. Kept
// internal so the divide-by-zero guard lives in exactly one place.
const mean = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
};

// Roll the member's rows into the personal stats card. Only *completed* solves count toward the
// completion totals and the average solve time; in-progress rows are ignored. Averages divide by
// the number of present samples, never by the total row count.
export const computePersonalStats = (
  input: PersonalStatsInput,
): PersonalStats => {
  const completed = input.completions.filter((c) => c.isCompleted);

  const solveMinutes = completed
    .map((c) => c.completionTimeMinutes)
    .filter((m): m is number => typeof m === "number");
  const totalSolveMinutes = solveMinutes.reduce((acc, m) => acc + m, 0);

  const distinctDefinitions = new Set(
    input.copies
      .map((c) => c.puzzleDefinitionKey)
      .filter((k): k is string => typeof k === "string" && k.length > 0),
  ).size;

  return {
    completionsCount: completed.length,
    totalSolveMinutes,
    averageSolveMinutes: mean(solveMinutes),
    puzzlesOwned: input.copies.length,
    distinctDefinitions,
    collectionsCount: input.collectionsCount,
    exchangesCompleted: input.exchanges.filter((e) => e.status === "completed")
      .length,
    averageRatingGiven:
      input.puzzleReviewRatings.length === 0
        ? null
        : mean(input.puzzleReviewRatings),
    averageRatingReceived: mean(input.reviewsReceived.map((r) => r.rating)),
    goalsActive: input.goals.filter((g) => g.isActive).length,
    goalsAchieved: input.goals.filter(
      (g) => g.currentCompletions >= g.targetCompletions,
    ).length,
  };
};
