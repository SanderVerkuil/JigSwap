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

// Up to `limit` open copies, newest first (by `createdAt`), platform-wide or for one definition.
// Reads the `isOpen === true` index range, so closed copies are never read once the flag is
// backfilled. Rows written before the flag existed (`isOpen` absent) are read from their own range
// and kept only when their availability is open: until library/backfillCopyOpenFlag has run, that
// range holds every legacy row, closed ones included, so it costs what the old full scan did; after
// it, the range is empty. Both ranges re-check availability, so a drifted flag never lists a closed
// copy.
export const openCopiesNewestFirst = async (
  ctx: QueryCtx,
  { puzzleId, limit }: { puzzleId?: Id<"puzzles">; limit: number },
): Promise<Doc<"ownedPuzzles">[]> => {
  const range = (isOpen: true | undefined) =>
    puzzleId === undefined
      ? ctx.db
          .query("ownedPuzzles")
          .withIndex("by_open", (q) => q.eq("isOpen", isOpen))
      : ctx.db
          .query("ownedPuzzles")
          .withIndex("by_puzzle_open", (q) =>
            q.eq("puzzleId", puzzleId).eq("isOpen", isOpen),
          );
  const takeOpen = async (isOpen: true | undefined) => {
    const rows: Doc<"ownedPuzzles">[] = [];
    for await (const row of range(isOpen).order("desc")) {
      if (!isOpenAvailability(row.availability)) continue;
      rows.push(row);
      if (rows.length >= limit) break;
    }
    return rows;
  };
  const [flagged, legacy] = await Promise.all([
    takeOpen(true),
    takeOpen(undefined),
  ]);
  return [...flagged, ...legacy].sort(newestFirst).slice(0, limit);
};
