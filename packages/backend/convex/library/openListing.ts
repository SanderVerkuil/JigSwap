import type { Doc } from "../_generated/dataModel";

// The one definition of an OPEN copy: at least one exchange-availability flag is set. Browse shows
// only open copies, and `ownedPuzzles.isOpen` is this value denormalized onto the row so Browse can
// read open copies from an index. Every in-memory "is it open" check uses this function too, so the
// stored flag and the checks can't disagree on what "open" means.
export const isOpenAvailability = (
  availability: Doc<"ownedPuzzles">["availability"],
): boolean =>
  availability.forTrade || availability.forSale || availability.forLend;
