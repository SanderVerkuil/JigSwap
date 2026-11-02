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

// How long after being listed a copy stays where it was when it closes and reopens. Browse lists the
// newest offers first, so without this a close and reopen loop would hold page 1 for everyone.
export const RELIST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * The listing fields a copy row carries next to `availability` (schema.ts): `isOpen`, `listedAt`
 * (when it was last offered, kept while closed) and `ownerPrivate` (the owner's profile is private;
 * absent means public). `before` is the stored row (null on insert): an open copy keeps the time it
 * was first offered, a copy that opens now is listed `now` unless it was already listed within
 * RELIST_COOLDOWN_MS, and a new open copy is listed when it was created. A stored open row without
 * `listedAt` predates the field and keeps its `createdAt`, so the backfill (which passes the row as
 * its own `before`) preserves today's order.
 */
export const listingStateOf = (
  row: Pick<Doc<"ownedPuzzles">, "availability" | "createdAt">,
  before: Pick<
    Doc<"ownedPuzzles">,
    "availability" | "listedAt" | "createdAt"
  > | null,
  ownerPrivate: boolean,
  now: number,
): Pick<Doc<"ownedPuzzles">, "isOpen" | "listedAt" | "ownerPrivate"> => {
  const isOpen = isOpenAvailability(row.availability);
  const wasOpen = before !== null && isOpenAvailability(before.availability);
  const lastListed = wasOpen
    ? (before.listedAt ?? before.createdAt)
    : before?.listedAt;
  let listedAt = lastListed;
  if (isOpen && !wasOpen) {
    if (before === null) listedAt = row.createdAt;
    else if (
      lastListed === undefined ||
      now - lastListed >= RELIST_COOLDOWN_MS
    ) {
      listedAt = now;
    }
  }
  return {
    isOpen,
    listedAt,
    ownerPrivate: ownerPrivate ? true : undefined,
  };
};

/** Whether a stored row's listing fields differ from `state` (absent and undefined are equal). */
export const listingStateDiffers = (
  row: Pick<Doc<"ownedPuzzles">, "isOpen" | "listedAt" | "ownerPrivate">,
  state: Pick<Doc<"ownedPuzzles">, "isOpen" | "listedAt" | "ownerPrivate">,
): boolean =>
  row.isOpen !== state.isOpen ||
  row.listedAt !== state.listedAt ||
  row.ownerPrivate !== state.ownerPrivate;

// The order Browse lists offers in: newest offer first. A row without `listedAt` (written before
// the field existed) sorts by when it was created.
export const listedTimeOf = (copy: Doc<"ownedPuzzles">): number =>
  copy.listedAt ?? copy.createdAt;

export const newestListedFirst = (
  a: Doc<"ownedPuzzles">,
  b: Doc<"ownedPuzzles">,
): number =>
  listedTimeOf(b) - listedTimeOf(a) || b._creationTime - a._creationTime;

// Which owners' open copies a window reads: those whose profile is public (the rows Browse can
// show to anyone) or private (only reachable through a circle).
export type ListingOwners = "public" | "private";

// Every row of one owner-visibility range of open copies, newest offer first, platform-wide or for
// one definition (`by_listing` / `by_puzzle_listing`). The public range is merged with the range of
// rows written before the listing fields existed (`isOpen` absent, owner not yet known): until
// library/backfillCopyOpenFlag has run, it holds every legacy row, closed and private-owner ones
// included; after it, the range is empty. Closed legacy rows are yielded too, so a caller's read
// budget counts every row read: decide with isOpenAvailability, and re-check the owner.
async function* openCopyRows(
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
  owners: ListingOwners,
): AsyncGenerator<Doc<"ownedPuzzles">> {
  const range = (isOpen: true | undefined, ownerPrivate: true | undefined) =>
    (puzzleId === undefined
      ? ctx.db
          .query("ownedPuzzles")
          .withIndex("by_listing", (q) =>
            q.eq("isOpen", isOpen).eq("ownerPrivate", ownerPrivate),
          )
      : ctx.db
          .query("ownedPuzzles")
          .withIndex("by_puzzle_listing", (q) =>
            q
              .eq("puzzleId", puzzleId)
              .eq("isOpen", isOpen)
              .eq("ownerPrivate", ownerPrivate),
          )
    )
      .order("desc")
      [Symbol.asyncIterator]();
  const flagged = range(true, owners === "private" ? true : undefined);
  if (owners === "private") {
    for (let a = await flagged.next(); !a.done; a = await flagged.next()) {
      yield a.value;
    }
    return;
  }
  const legacy = range(undefined, undefined);
  let a = await flagged.next();
  let b = await legacy.next();
  while (!a.done || !b.done) {
    if (b.done || (!a.done && newestListedFirst(a.value, b.value) <= 0)) {
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
  // Accepted open copies: in read order (newest offer first), then the held-back ones that fitted.
  rows: Doc<"ownedPuzzles">[];
  // True when an open copy may have been left out (a budget ran out, the window filled up, or
  // held-back rows did not fit): totals over the window are then lower bounds.
  cut: boolean;
};

/**
 * A bounded candidate window of open copies, newest offer first, of public or of private owners,
 * that no single owner can monopolise.
 * `accept` is the caller's gate (visibility, blocks, own copies, cheap filters): a refused row takes
 * no slot. Each owner gets `perOwner` rows looked at before the others have had theirs; the rest are
 * held back and fill whatever room is left once reading stops. Reading stops when the window is
 * full, or after `readBudget` rows or `maxOwners` owners, so a flood costs a fixed amount, and older
 * listings stay in the window unless the flood is bigger than the read budget. `accept` runs again
 * for held-back rows, whose owners it has already seen, so it should cache per-owner lookups.
 */
export const openListingWindow = async (
  ctx: QueryCtx,
  {
    puzzleId,
    owners,
  }: { puzzleId: Id<"puzzles"> | undefined; owners: ListingOwners },
  limits: OpenWindowLimits,
  accept: (copy: Doc<"ownedPuzzles">) => Promise<boolean>,
): Promise<OpenWindow> => {
  const rows: Doc<"ownedPuzzles">[] = [];
  const heldBack: Doc<"ownedPuzzles">[] = [];
  const lookedAt = new Map<Id<"users">, number>();
  let read = 0;
  let cut = false;
  for await (const copy of openCopyRows(ctx, puzzleId, owners)) {
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
