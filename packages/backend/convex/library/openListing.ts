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

// Where a walk over the listing indexes reads next, newest offer first.
type ListingRange =
  | { kind: "all" }
  // Rows listed at exactly this time, created before `before` (the index ends in _creationTime).
  | { kind: "sameTime"; listedAt: number | undefined; before: number }
  | { kind: "listedBefore"; listedAt: number };

// One index range of `isOpen` / `ownerPrivate` rows, platform-wide or for one definition.
const listingRows = (
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
  isOpen: true | undefined,
  ownerPrivate: true | undefined,
  range: ListingRange,
) =>
  (puzzleId === undefined
    ? ctx.db.query("ownedPuzzles").withIndex("by_listing", (q) => {
        const rows = q.eq("isOpen", isOpen).eq("ownerPrivate", ownerPrivate);
        return range.kind === "all"
          ? rows
          : range.kind === "sameTime"
            ? rows
                .eq("listedAt", range.listedAt)
                .lt("_creationTime", range.before)
            : rows.lt("listedAt", range.listedAt);
      })
    : ctx.db.query("ownedPuzzles").withIndex("by_puzzle_listing", (q) => {
        const rows = q
          .eq("puzzleId", puzzleId)
          .eq("isOpen", isOpen)
          .eq("ownerPrivate", ownerPrivate);
        return range.kind === "all"
          ? rows
          : range.kind === "sameTime"
            ? rows
                .eq("listedAt", range.listedAt)
                .lt("_creationTime", range.before)
            : rows.lt("listedAt", range.listedAt);
      })
  ).order("desc");

// A row's place in the merged order.
export type ListingKey = [listedTime: number, creationTime: number];

// How many members one cursor remembers as past their share of a page, which also bounds its size.
export const LISTING_HELD_OWNERS_MAX = 16;

/**
 * Where a paged walk over public listings stopped (library/browseOwnedPuzzles). The flagged and the
 * legacy range each resume after their own last row: the merged order compares `listedAt ?? createdAt`,
 * which neither index holds on its own. `sortKey` is the last row's place in the merged order, for
 * the copies a caller merges in from memory. `held` names the members past their share of a page and
 * where in the order their rows started waiting, and `secondPass` says the walk has reached the end
 * once and started over for those rows.
 */
export type ListingCursor = {
  flagged?: [listedAt: number | null, creationTime: number];
  legacy?: number;
  sortKey?: ListingKey;
  held?: [ownerId: string, ...from: ListingKey][];
  secondPass?: true;
};

export const encodeListingCursor = (cursor: ListingCursor): string =>
  JSON.stringify(cursor);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isHeldOwner = (
  value: unknown,
): value is NonNullable<ListingCursor["held"]>[number] =>
  Array.isArray(value) &&
  typeof value[0] === "string" &&
  isFiniteNumber(value[1]) &&
  isFiniteNumber(value[2]);

/** A cursor as the client sent it back. Anything unreadable starts from the newest offer: a cursor
 * only says where to read, and every row is still gated. */
export const decodeListingCursor = (
  cursor: string | null | undefined,
): ListingCursor | undefined => {
  if (!cursor) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { flagged, legacy, sortKey, held, secondPass } = parsed as Record<
    string,
    unknown
  >;
  return {
    ...(Array.isArray(flagged) &&
    (flagged[0] === null || isFiniteNumber(flagged[0])) &&
    isFiniteNumber(flagged[1])
      ? { flagged: [flagged[0] as number | null, flagged[1]] }
      : {}),
    ...(isFiniteNumber(legacy) ? { legacy } : {}),
    ...(Array.isArray(sortKey) &&
    isFiniteNumber(sortKey[0]) &&
    isFiniteNumber(sortKey[1])
      ? { sortKey: [sortKey[0], sortKey[1]] }
      : {}),
    ...(Array.isArray(held)
      ? { held: held.filter(isHeldOwner).slice(0, LISTING_HELD_OWNERS_MAX) }
      : {}),
    ...(secondPass === true ? { secondPass } : {}),
  };
};

async function* flaggedRowsAfter(
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
  ownerPrivate: true | undefined,
  after: ListingCursor["flagged"],
): AsyncGenerator<Doc<"ownedPuzzles">> {
  const rows = (range: ListingRange) =>
    listingRows(ctx, puzzleId, true, ownerPrivate, range);
  if (after === undefined) {
    yield* rows({ kind: "all" });
    return;
  }
  const [listedAt, before] = after;
  yield* rows({ kind: "sameTime", listedAt: listedAt ?? undefined, before });
  // A row without `listedAt` sorts below every timestamp, so this range includes those too.
  if (listedAt !== null) yield* rows({ kind: "listedBefore", listedAt });
}

async function* legacyRowsAfter(
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
  after: ListingCursor["legacy"],
): AsyncGenerator<Doc<"ownedPuzzles">> {
  yield* listingRows(
    ctx,
    puzzleId,
    undefined,
    undefined,
    after === undefined
      ? { kind: "all" }
      : { kind: "sameTime", listedAt: undefined, before: after },
  );
}

export const listingKeyOf = (copy: Doc<"ownedPuzzles">): ListingKey => [
  listedTimeOf(copy),
  copy._creationTime,
];

const isOlderThanKey = (
  copy: Doc<"ownedPuzzles">,
  [listedTime, creationTime]: ListingKey,
): boolean => {
  const listed = listedTimeOf(copy);
  return (
    listed < listedTime ||
    (listed === listedTime && copy._creationTime < creationTime)
  );
};

/** Whether a row sits at this place in the merged order or further down. */
export const isAtOrPastKey = (
  copy: Doc<"ownedPuzzles">,
  key: ListingKey,
): boolean =>
  isOlderThanKey(copy, key) ||
  (listedTimeOf(copy) === key[0] && copy._creationTime === key[1]);

/**
 * The open copies of public owners after `after`, newest offer first, platform-wide or for one
 * definition (`by_listing` / `by_puzzle_listing`), each with the cursor that resumes right after it.
 * Reads the index only as far as the caller keeps asking. The range is merged with the range of rows
 * written before the listing fields existed (`isOpen` absent, owner not yet known): until
 * library/backfillCopyOpenFlag has run, it holds every legacy row, closed and private-owner ones
 * included; after it, the range is empty. Closed legacy rows are yielded too, so a caller's read
 * budget counts every row read: decide with isOpenAvailability, and re-check the owner.
 *
 * `alsoListed` are copies a caller holds in memory (circle-shared ones, which may be private owners'
 * and so in no public range): merged in by the same order, each yielded once.
 */
export async function* publicListingsAfter(
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
  after: ListingCursor | undefined,
  alsoListed: readonly Doc<"ownedPuzzles">[] = [],
): AsyncGenerator<{ copy: Doc<"ownedPuzzles">; cursor: ListingCursor }> {
  const flagged = flaggedRowsAfter(ctx, puzzleId, undefined, after?.flagged);
  const legacy = legacyRowsAfter(ctx, puzzleId, after?.legacy);
  const sortKey = after?.sortKey;
  const held = alsoListed
    .filter((copy) => sortKey === undefined || isOlderThanKey(copy, sortKey))
    .sort(newestListedFirst);
  let heldAt = 0;
  let cursor: ListingCursor = { ...after };
  const yielded = new Set<Id<"ownedPuzzles">>();
  let a = await flagged.next();
  let b = await legacy.next();
  for (;;) {
    const fromFlagged = a.done ? undefined : a.value;
    const fromLegacy = b.done ? undefined : b.value;
    const fromHeld = held[heldAt];
    // On a tie the index wins, so a held copy that is also in the index moves its position on.
    let next = fromFlagged ?? fromLegacy ?? fromHeld;
    if (next === undefined) return;
    if (fromLegacy && newestListedFirst(fromLegacy, next) < 0)
      next = fromLegacy;
    if (fromHeld && newestListedFirst(fromHeld, next) < 0) next = fromHeld;

    if (next === fromFlagged) {
      cursor = {
        ...cursor,
        flagged: [next.listedAt ?? null, next._creationTime],
      };
      a = await flagged.next();
    } else if (next === fromLegacy) {
      cursor = { ...cursor, legacy: next._creationTime };
      b = await legacy.next();
    } else {
      heldAt += 1;
    }
    if (yielded.has(next._id)) continue;
    yielded.add(next._id);
    cursor = {
      ...cursor,
      sortKey: [listedTimeOf(next), next._creationTime],
    };
    yield { copy: next, cursor };
  }
}

// Every row of one owner-visibility range of open copies, newest offer first. See
// publicListingsAfter for what the public range holds.
async function* openCopyRows(
  ctx: QueryCtx,
  puzzleId: Id<"puzzles"> | undefined,
  owners: ListingOwners,
): AsyncGenerator<Doc<"ownedPuzzles">> {
  if (owners === "private") {
    yield* flaggedRowsAfter(ctx, puzzleId, true, undefined);
    return;
  }
  for await (const { copy } of publicListingsAfter(ctx, puzzleId, undefined)) {
    yield copy;
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
