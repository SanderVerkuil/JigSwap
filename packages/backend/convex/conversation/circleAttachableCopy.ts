import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isOpen } from "../library/canViewCopy";
import { profileVisibilityOf } from "../social/privacy";
import { circleRowOf } from "./readModelHelpers";

/**
 * The circle-thread attach rule, shared by postMessage's gate and listAttachableCopies so the
 * picker offers exactly what a post accepts. `authorId` must already be a CURRENT member of the
 * thread's circle (both callers check that first). A copy is attachable iff the author OWNS it,
 * it is OPEN (offered for at least one kind of exchange), and either
 *   (a) the author's profile is public, or
 *   (b) the copy is shared into THIS circle (circleCopyShares.by_circle_copy) and the circle exists.
 *
 * Why this IMPLIES "every current, non-blocked member may view it" (canViewCopy) without a
 * per-member loop (a circle has up to 50 members; per-member checks across the picker's scan would
 * not fit a query's read budget): for a co-member M who is not blocked either way with the author,
 * an open copy is never private, so canViewCopy reaches rule 3 (owner public + open: true under
 * (a)) and rule 4 (open + shared into a circle both M and the owner are in, which the circle-aware
 * policy then allows for an open copy: true under (b)). It is an implication, not an equivalence:
 * the rule is deliberately STRICTER than the per-member check, so a copy every member could see
 * only through household links, mutual follows, holding it (heldBy) or a share into some OTHER
 * circle they all happen to be in is not offered.
 *
 * One more gap, in the safe direction: canViewCopy's circle clause (isCircleSharedWithViewer)
 * fails closed past MAX_SHARES_READ_PER_COPY shares of the copy when M is in more than
 * MAX_VIEWER_CIRCLES_READ circles. Such an M then gets the "no longer available" placeholder for a
 * copy accepted under (b); nobody ever sees a card they may not view.
 *
 * A member blocked either way with the author is deliberately NOT considered: refusing the attach
 * would tell the author about a block they must not learn of. That member simply gets the
 * "no longer available" placeholder, because every card is re-checked per viewer at read time
 * (threadMessageViewOf -> canViewCopy).
 */
export const circleAttachableCopies = (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  authorId: Id<"users">,
) => {
  const circleId = thread.circleId;
  let ready: Promise<{ authorPublic: boolean; circleExists: boolean }> | null =
    null;
  return async (copy: Doc<"ownedPuzzles">): Promise<boolean> => {
    if (circleId === undefined) return false;
    if (copy.ownerId !== authorId || !isOpen(copy)) return false;
    ready ??= (async () => ({
      authorPublic: (await profileVisibilityOf(ctx, authorId)) === "public",
      circleExists: (await circleRowOf(ctx, circleId)) !== null,
    }))();
    const { authorPublic, circleExists } = await ready;
    if (!circleExists) return false;
    if (authorPublic) return true;
    const copyId = copy.aggregateId;
    if (copyId === undefined) return false;
    return (
      (await ctx.db
        .query("circleCopyShares")
        .withIndex("by_circle_copy", (q) =>
          q.eq("circleId", circleId).eq("copyId", copyId),
        )
        .first()) !== null
    );
  };
};
