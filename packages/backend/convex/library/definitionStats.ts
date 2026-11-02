import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { isCopyPrivate } from "./copyVisibility";
import {
  communityOwnersOf,
  completionTotalsOf,
  finishDaysOf,
  publicAvailabilityOf,
  ratingBreakdownFromTotals,
  ratingBreakdownOf,
  ratingTotalsOf,
  type CompletionTotals,
  type PublicAvailability,
  type RatingBreakdown,
  type RatingTotals,
} from "./definitionAggregates";
import { isOpenAvailability } from "./openListing";

// The definitionStats read model (schema.ts; PERF-B4m, SEC-29): per definition, the
// viewer-independent sums the catalog and definition pages derive their numbers from, so those
// pages read one row instead of every review, copy and completion of the definition.
//
// Life cycle: a write that changes what a definition's aggregates count MARKS it
// (markDefinitionStatsStale and the mark*Change helpers below, called from the copy, completion,
// review and profile repositories, the exchange settlement and the account purge). A mark flags the
// row stale and schedules one `recompute`, which recomputes the totals from source with the very
// helpers the pages used to run live (library/definitionAggregates), so the numbers keep their
// meaning. A nightly `reconcile` recomputes every definition: it is the backfill, and it repairs a
// row a write path forgot to mark (logged as drift). A row left stale because its recompute threw
// is logged and re-scheduled by the next mark or the reconcile (STALE_RETRY_MS). Until a
// definition's totals exist, reads compute them live, as before.

export type DefinitionTotals = RatingTotals &
  CompletionTotals & {
    communityOwners: number;
    publicAvailable: PublicAvailability["byType"];
  };

type StoredTotals = NonNullable<Doc<"definitionStats">["totals"]>;

// Profile visibility fan-out: copies per batch (each at most one mark).
const OWNER_MARK_BATCH = 100;
// A recompute normally lands within seconds. A row still stale after this long lost its recompute
// (it threw: read limits on a very large definition, or write conflicts until retries ran out), so
// the next mark, or the nightly reconcile, logs it and schedules another.
export const STALE_RETRY_MS = 5 * 60 * 1000;
// Definitions per reconcile batch (one scheduled recompute each). `batchSize` overrides it,
// floored and clamped to 1..MAX, below Convex's limit on functions scheduled per mutation.
export const RECONCILE_BATCH = 100;
export const RECONCILE_MAX_BATCH = 500;

const statsRowOf = (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<Doc<"definitionStats"> | null> =>
  ctx.db
    .query("definitionStats")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .unique();

/** The definition's totals computed from source: every review, copy and completion of it. */
export const computeDefinitionTotals = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<DefinitionTotals> => {
  const rating = await ratingTotalsOf(ctx, puzzleId);
  const owned = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
    .collect();
  const completions = await completionTotalsOf(ctx, puzzleId, owned);
  const { byType } = await publicAvailabilityOf(ctx, owned);
  return {
    ...rating,
    ...completions,
    // No viewer: private copies never count here (the member view adds its household's own).
    communityOwners: communityOwnersOf(owned),
    publicAvailable: byType,
  };
};

/** The definition's stored totals, or null until its first recompute (the caller then computes
 * live). Stale totals are served: a recompute is already scheduled. One indexed read. */
export const definitionTotalsOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<DefinitionTotals | null> => {
  const totals = (await statsRowOf(ctx, puzzleId))?.totals;
  if (!totals) return null;
  const [five = 0, four = 0, three = 0, two = 0, one = 0] = totals.breakdown;
  return { ...totals, breakdown: [five, four, three, two, one] };
};

/** The definition's totals: stored, or computed live (at the old cost) until its first recompute. */
export const definitionTotalsOrLive = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<DefinitionTotals> =>
  (await definitionTotalsOf(ctx, puzzleId)) ??
  (await computeDefinitionTotals(ctx, puzzleId));

/** The definition's community rating: stored, or read live until its first recompute. */
export const definitionRatingOf = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles">,
): Promise<RatingBreakdown> => {
  const totals = await definitionTotalsOf(ctx, puzzleId);
  return totals
    ? ratingBreakdownFromTotals(totals)
    : ratingBreakdownOf(ctx, puzzleId);
};

// Every field, in a fixed order: the stored object comes back with its keys sorted.
const totalsKey = (t: StoredTotals | DefinitionTotals): string =>
  JSON.stringify([
    t.ratingCount,
    t.ratingSum,
    t.breakdown,
    t.completedCount,
    t.finishDaysSum,
    t.finishDaysCount,
    t.communityOwners,
    t.publicAvailable.swap,
    t.publicAvailable.lend,
    t.publicAvailable.sale,
  ]);

// A stale row whose recompute should have landed by `now`, logged as such. A row marked stale
// before `staleSince` existed counts as overdue.
const recomputeOverdue = (
  row: Doc<"definitionStats">,
  now: number,
): boolean => {
  if (row.stale !== true) return false;
  if (row.staleSince !== undefined && now - row.staleSince < STALE_RETRY_MS) {
    return false;
  }
  logEvent({
    event: "library.definitionStats.recomputeOverdue",
    outcome: "error",
    puzzle_id: row.puzzleId,
    stale_ms: row.staleSince === undefined ? null : now - row.staleSince,
  });
  return true;
};

/**
 * Mark a definition's totals stale and schedule their recompute. At most one recompute is pending
 * per definition: a row stale since less than STALE_RETRY_MS has one scheduled (in this
 * transaction or an earlier one), and a definition without a row gets one, so later marks in the
 * same transaction see it. A row stale for longer lost its recompute: it is logged and re-scheduled.
 */
export const markDefinitionStatsStale = async (
  ctx: MutationCtx,
  puzzleId: Id<"puzzles">,
): Promise<void> => {
  const now = Date.now();
  const row = await statsRowOf(ctx, puzzleId);
  if (row?.stale === true && !recomputeOverdue(row, now)) return;
  if (row) await ctx.db.patch(row._id, { stale: true, staleSince: now });
  else {
    await ctx.db.insert("definitionStats", {
      puzzleId,
      stale: true,
      staleSince: now,
    });
  }
  await ctx.scheduler.runAfter(0, internal.library.definitionStats.recompute, {
    puzzleId,
  });
};

type CopyStatsFields = Pick<
  Doc<"ownedPuzzles">,
  | "puzzleId"
  | "ownerId"
  | "availability"
  | "visibility"
  | "visibilityAuthoritative"
>;

// What a copy counts for in its definition's totals: as an owner unless it is private, as a public
// listing of its priority type while it is open (and its owner's profile is public), and as the
// link of its copy-only completions.
const copyStatsKey = (copy: CopyStatsFields): string =>
  JSON.stringify([
    copy.puzzleId,
    copy.ownerId,
    isCopyPrivate(copy),
    copy.availability.forTrade,
    copy.availability.forSale,
    copy.availability.forLend,
  ]);

/** Mark the definitions a copy write touches (`null` = no row on that side), when the write
 * changes anything the copy counts for. */
export const markCopyStatsChange = async (
  ctx: MutationCtx,
  before: CopyStatsFields | null,
  after: CopyStatsFields | null,
): Promise<void> => {
  if (before && after && copyStatsKey(before) === copyStatsKey(after)) return;
  for (const puzzleId of new Set([before?.puzzleId, after?.puzzleId])) {
    if (puzzleId) await markDefinitionStatsStale(ctx, puzzleId);
  }
};

type CompletionStatsFields = Pick<
  Doc<"completions">,
  | "puzzleId"
  | "ownedPuzzleId"
  | "isCompleted"
  | "startDate"
  | "endDate"
  | "completionTimeMinutes"
>;

const completionStatsKey = (c: CompletionStatsFields): string =>
  JSON.stringify([
    c.puzzleId,
    c.ownedPuzzleId,
    c.isCompleted,
    c.isCompleted ? finishDaysOf(c) : null,
  ]);

/** Mark the definitions a completion write touches (`null` = no row on that side): the one it
 * names and the one its copy belongs to, before and after. An unfinished solve counts nowhere. */
export const markCompletionStatsChange = async (
  ctx: MutationCtx,
  before: CompletionStatsFields | null,
  after: CompletionStatsFields | null,
): Promise<void> => {
  if (!before?.isCompleted && !after?.isCompleted) return;
  if (
    before &&
    after &&
    completionStatsKey(before) === completionStatsKey(after)
  ) {
    return;
  }
  const definitions = new Set<Id<"puzzles">>();
  for (const completion of [before, after]) {
    if (completion?.puzzleId) definitions.add(completion.puzzleId);
    if (completion?.ownedPuzzleId) {
      const copy = await ctx.db.get(completion.ownedPuzzleId);
      if (copy) definitions.add(copy.puzzleId);
    }
  }
  for (const puzzleId of definitions) {
    await markDefinitionStatsStale(ctx, puzzleId);
  }
};

/** A member's profile visibility changed and their copies have been re-stamped
 * (library/ownerListingVisibility): their open copies now count (or stop counting) as public
 * listings. Their library can be large, so the definitions are marked in batches. */
export const markOwnerListingsChange = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<void> => {
  await ctx.scheduler.runAfter(
    0,
    internal.library.definitionStats.markOwnerListingsStale,
    { ownerId },
  );
};

// Marks the definitions of one page of the owner's OPEN copies and reschedules itself.
export const markOwnerListingsStale = internalMutation({
  args: { ownerId: v.id("users"), cursor: v.optional(v.string()) },
  handler: async (ctx, { ownerId, cursor }): Promise<void> => {
    const page = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .paginate({ numItems: OWNER_MARK_BATCH, cursor: cursor ?? null });
    const definitions = new Set(
      page.page
        .filter((copy) => isOpenAvailability(copy.availability))
        .map((copy) => copy.puzzleId),
    );
    for (const puzzleId of definitions) {
      await markDefinitionStatsStale(ctx, puzzleId);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.definitionStats.markOwnerListingsStale,
        { ownerId, cursor: page.continueCursor },
      );
    }
  },
});

// Recomputes one definition's totals from source and writes them only when they changed (or to
// clear the stale flag), so an in-step definition costs readers nothing. A row that was not marked
// stale but differs from its sources means some write path skipped its mark: logged as drift and
// repaired. A definition that no longer exists loses its row.
export const recompute = internalMutation({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, { puzzleId }): Promise<void> => {
    const row = await statsRowOf(ctx, puzzleId);
    if ((await ctx.db.get(puzzleId)) === null) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    const totals = await computeDefinitionTotals(ctx, puzzleId);
    const computedAt = Date.now();
    if (!row) {
      await ctx.db.insert("definitionStats", { puzzleId, totals, computedAt });
      return;
    }
    const inStep =
      row.totals !== undefined && totalsKey(row.totals) === totalsKey(totals);
    if (inStep) {
      if (row.stale === true) {
        await ctx.db.patch(row._id, {
          stale: undefined,
          staleSince: undefined,
        });
      }
      return;
    }
    if (row.totals !== undefined && row.stale !== true) {
      logEvent({
        event: "library.definitionStats.drift",
        outcome: "success",
        puzzle_id: puzzleId,
      });
    }
    await ctx.db.patch(row._id, {
      totals,
      stale: undefined,
      staleSince: undefined,
      computedAt,
    });
  },
});

// Recomputes every definition: pages through `puzzles` and schedules one `recompute` per
// definition (each its own transaction, so one oversized definition can't stall the rest), then
// reschedules itself. Runs nightly (crons.ts) and is the backfill: the first run gives every
// definition its row. Writes only rows whose totals changed, so a re-run writes nothing. Runbook:
// docs/deployment/one-shot-migrations.md.
export const reconcile = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    // Running count carried across batches so the final batch logs the whole run.
    scheduled: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const numItems = Math.max(
      1,
      Math.min(
        RECONCILE_MAX_BATCH,
        Math.floor(args.batchSize ?? RECONCILE_BATCH),
      ),
    );
    const page = await ctx.db
      .query("puzzles")
      .paginate({ numItems, cursor: args.cursor ?? null });
    const now = Date.now();
    for (const puzzle of page.page) {
      // Surfaces a definition whose recompute keeps failing even when no write marks it.
      const row = await statsRowOf(ctx, puzzle._id);
      if (row) recomputeOverdue(row, now);
      await ctx.scheduler.runAfter(
        0,
        internal.library.definitionStats.recompute,
        { puzzleId: puzzle._id },
      );
    }
    const scheduled = (args.scheduled ?? 0) + page.page.length;
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.definitionStats.reconcile,
        {
          cursor: page.continueCursor,
          scheduled,
          ...(args.batchSize !== undefined && { batchSize: args.batchSize }),
        },
      );
      return;
    }
    logEvent({
      event: "library.definitionStats.reconcile",
      outcome: "success",
      definitions: scheduled,
    });
  },
});
