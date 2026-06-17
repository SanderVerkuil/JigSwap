import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";
import { collectCircleSharedCopies } from "./circleSharedCopies";

// A copy is "open" iff at least one exchange-availability flag is set (identical to
// browseOwnedPuzzles/getPuzzleDefinitionView).
const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

// THE single copy-reachability gate, lifted out of browseOwnedPuzzles/getPuzzleDefinitionView so the
// copy-detail reads (getCopyInstanceView, getCopyLoanHistory, getCopyCustodyTimeline) decide
// visibility identically to Browse. A copy is viewable by `viewerId` iff:
//   1. the viewer owns it; OR
//   2. the owner's profile is PUBLIC and the copy is OPEN (at least one availability flag); OR
//   3. the copy is shared into a circle the viewer belongs to.
// Anything else (a private/unreachable copy of another member) is NOT viewable.
export const canViewCopy = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> => {
  if (copy.ownerId === viewerId) return true;

  if (
    isOpen(copy) &&
    (await profileVisibilityOf(ctx, copy.ownerId)) === "public"
  ) {
    return true;
  }

  // Circle-shared reachability: the copy must appear among the OPEN copies shared into one of the
  // viewer's circles — browseOwnedPuzzles filters the circle-shared set by isOpen before matching,
  // so a closed circle copy is never reachable there; mirror that exactly.
  const circleShared = (await collectCircleSharedCopies(ctx, viewerId)).filter(
    isOpen,
  );
  return circleShared.some((c) => c._id === copy._id);
};
