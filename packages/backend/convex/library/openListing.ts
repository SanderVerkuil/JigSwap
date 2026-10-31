import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The one definition of an OPEN copy: at least one exchange-availability flag is set. Browse shows
// only open copies, and `ownedPuzzles.isOpen` is this value denormalized onto the row so Browse can
// read open copies from an index. Every in-memory "is it open" check uses this function too, so the
// stored flag and the checks can't disagree on what "open" means.
export const isOpenAvailability = (
  availability: Doc<"ownedPuzzles">["availability"],
): boolean =>
  availability.forTrade || availability.forSale || availability.forLend;

const newestFirst = (a: Doc<"ownedPuzzles">, b: Doc<"ownedPuzzles">) =>
  b.createdAt - a.createdAt || b._creationTime - a._creationTime;

// Every row of the open-copy ranges, newest first (by `createdAt`), platform-wide or for one
// definition: the `isOpen === true` index range merged with the range of rows written before the
// flag existed (`isOpen` absent). Until library/backfillCopyOpenFlag has run, that second range
// holds every legacy row, closed ones included; after it, the range is empty. Closed legacy rows
// are yielded too, so a caller's read budget counts every row read: decide with isOpenAvailability.
async function* openCopyRows(
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
): AsyncGenerator<Doc<"ownedPuzzles">> {
  const range = (isOpen: true | undefined) =>
    (puzzleId === undefined
      ? ctx.db
          .query("ownedPuzzles")
          .withIndex("by_open", (q) => q.eq("isOpen", isOpen))
      : ctx.db
          .query("ownedPuzzles")
          .withIndex("by_puzzle_open", (q) =>
            q.eq("puzzleId", puzzleId).eq("isOpen", isOpen),
          )
    )
      .order("desc")
      [Symbol.asyncIterator]();
  const flagged = range(true);
  const legacy = range(undefined);
  let a = await flagged.next();
  let b = await legacy.next();
  while (!a.done || !b.done) {
    if (b.done || (!a.done && newestFirst(a.value, b.value) <= 0)) {
      yield a.value;
      a = await flagged.next();
    } else {
      yield b.value;
      b = await legacy.next();
    }
  }
}

export type OpenWindowLimits = {
  // Rows the window holds at most.
  size: number;
  // Rows of one owner looked at before every other owner has had a turn. The rest of that owner's
  // rows are held back and only fill room the others leave, so one member's pile of listings can't
  // crowd everyone else out of the window.
  perOwner: number;
  // Rows read at most, open or not.
  readBudget: number;
  // Distinct owners looked at at most: each one costs the caller's gate a lookup.
  maxOwners: number;
};

export type OpenWindow = {
  // Accepted open copies: in read order (newest first), then the held-back ones that fitted.
  rows: Doc<"ownedPuzzles">[];
  // True when an open copy may have been left out (a budget ran out, the window filled up, or
  // held-back rows did not fit): totals over the window are then lower bounds.
  cut: boolean;
};

/**
 * A bounded candidate window of open copies, newest first, that no single owner can monopolise.
 * `accept` is the caller's gate (visibility, blocks, own copies, cheap filters): a refused row takes
 * no slot. Each owner gets `perOwner` rows looked at before the others have had theirs; the rest are
 * held back and fill whatever room is left once reading stops. Reading stops when the window is
 * full, or after `readBudget` rows or `maxOwners` owners, so a flood costs a fixed amount, and older
 * listings stay in the window unless the flood is bigger than the read budget. `accept` runs again
 * for held-back rows, whose owners it has already seen, so it should cache per-owner lookups.
 */
export const openListingWindow = async (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
  limits: OpenWindowLimits,
  accept: (copy: Doc<"ownedPuzzles">) => Promise<boolean>,
): Promise<OpenWindow> => {
  const rows: Doc<"ownedPuzzles">[] = [];
  const heldBack: Doc<"ownedPuzzles">[] = [];
  const lookedAt = new Map<Id<"users">, number>();
  let read = 0;
  let cut = false;
  for await (const copy of openCopyRows(ctx, puzzleId)) {
    if (rows.length >= limits.size || read >= limits.readBudget) {
      cut = true;
      break;
    }
    read++;
    if (!isOpenAvailability(copy.availability)) continue;
    const seen = lookedAt.get(copy.ownerId) ?? 0;
    if (seen === 0 && lookedAt.size >= limits.maxOwners) {
      cut = true;
      break;
    }
    if (seen >= limits.perOwner) {
      heldBack.push(copy);
      continue;
    }
    lookedAt.set(copy.ownerId, seen + 1);
    if (await accept(copy)) rows.push(copy);
  }
  for (const copy of heldBack) {
    if (rows.length >= limits.size) {
      cut = true;
      break;
    }
    if (await accept(copy)) rows.push(copy);
  }
  return { rows, cut };
};
