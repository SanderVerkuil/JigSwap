import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// How many of a member's copies one count may read. No real member comes close (the same bound as
// identity/getUserStats); past it a read undercounts rather than failing.
export const LIBRARY_COUNT_SCAN_CAP = 5000;

export interface LibraryCounts {
  /** Every copy the member owns, private ones included. */
  owned: number;
  /** The copies among them marked for trade. */
  forTrade: number;
}

const memberCountsRow = (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<Doc<"memberLibraryCounts"> | null> =>
  ctx.db
    .query("memberLibraryCounts")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();

/**
 * Counts the member's copies from the rows. `complete` is false past LIBRARY_COUNT_SCAN_CAP, when
 * the numbers are a lower bound and must not be stored.
 */
export const scanMemberLibraryCounts = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<LibraryCounts & { complete: boolean }> => {
  const copies = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
    .take(LIBRARY_COUNT_SCAN_CAP + 1);
  const counted = copies.slice(0, LIBRARY_COUNT_SCAN_CAP);
  return {
    owned: counted.length,
    forTrade: counted.filter((copy) => copy.availability.forTrade).length,
    complete: copies.length <= LIBRARY_COUNT_SCAN_CAP,
  };
};

/**
 * The member's counts: the stored row (one read, unaffected by edits that move neither number), or
 * a bounded count of the library while the member has no row yet (before the backfill has reached
 * them, or past the scan cap).
 */
export const readMemberLibraryCounts = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<LibraryCounts> => {
  const row = await memberCountsRow(ctx, memberId);
  if (row) return { owned: row.owned, forTrade: row.forTrade };
  const { owned, forTrade } = await scanMemberLibraryCounts(ctx, memberId);
  return { owned, forTrade };
};

type CountedCopy = Pick<Doc<"ownedPuzzles">, "ownerId" | "availability">;

/**
 * Keeps the counters in step with one copy write (`null` = no row on that side). Call it AFTER the
 * write: a member without a row gets one counted from their copies as they now stand, so a member
 * who predates the backfill, or a new member's first copy, ends up right without a separate step.
 * A write that moves neither number touches nothing, so an edit of a copy's notes doesn't re-run
 * anything subscribed to the counts. Numbers never go below zero: a lagging row is corrected by the
 * backfill, not carried negative.
 */
export const syncMemberLibraryCounts = async (
  ctx: MutationCtx,
  before: CountedCopy | null,
  after: CountedCopy | null,
): Promise<void> => {
  const deltas = new Map<Id<"users">, LibraryCounts>();
  const add = (copy: CountedCopy, sign: 1 | -1) => {
    const delta = deltas.get(copy.ownerId) ?? { owned: 0, forTrade: 0 };
    delta.owned += sign;
    if (copy.availability.forTrade) delta.forTrade += sign;
    deltas.set(copy.ownerId, delta);
  };
  if (before) add(before, -1);
  if (after) add(after, 1);

  for (const [memberId, delta] of deltas) {
    if (delta.owned === 0 && delta.forTrade === 0) continue;
    const row = await memberCountsRow(ctx, memberId);
    if (row) {
      await ctx.db.patch(row._id, {
        owned: Math.max(0, row.owned + delta.owned),
        forTrade: Math.max(0, row.forTrade + delta.forTrade),
      });
      continue;
    }
    const scan = await scanMemberLibraryCounts(ctx, memberId);
    if (scan.complete) {
      await ctx.db.insert("memberLibraryCounts", {
        memberId,
        owned: scan.owned,
        forTrade: scan.forTrade,
      });
    }
  }
};

/** Account deletion: the counters go with the member's copies. */
export const deleteMemberLibraryCounts = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
): Promise<void> => {
  const row = await memberCountsRow(ctx, memberId);
  if (row) await ctx.db.delete(row._id);
};
