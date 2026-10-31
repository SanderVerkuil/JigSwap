import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

// Delete the `circleCopyShares` links of one copy (`copyId` is the Library CopyId aggregateId):
// in one circle when `circleId` is given, otherwise in every circle it was shared into. Sharing owns
// this read model, so other contexts' in-transaction reactions withdraw links through here rather
// than touching the table.
export const deleteCircleSharesOfCopy = async (
  ctx: MutationCtx,
  copyId: string,
  circleId?: string,
): Promise<void> => {
  const shares =
    circleId === undefined
      ? await ctx.db
          .query("circleCopyShares")
          .withIndex("by_copy", (q) => q.eq("copyId", copyId))
          .collect()
      : await ctx.db
          .query("circleCopyShares")
          .withIndex("by_circle_copy", (q) =>
            q.eq("circleId", circleId).eq("copyId", copyId),
          )
          .collect();
  for (const share of shares) await ctx.db.delete(share._id);
};

/** Whether the copy (its Library CopyId) is shared into the circle: one indexed point read. */
export const isCopySharedInto = async (
  ctx: QueryCtx,
  circleId: string,
  copyId: string,
): Promise<boolean> =>
  (await ctx.db
    .query("circleCopyShares")
    .withIndex("by_circle_copy", (q) =>
      q.eq("circleId", circleId).eq("copyId", copyId),
    )
    .first()) !== null;

/**
 * The copy (by its Library CopyId) when `memberId` owns it, else null. Only a copy's owner may
 * share it into a circle or take the share back; a missing copy and someone else's read the same
 * (see copyNotFound), so the share functions can't be used to tell which copy ids exist.
 */
export const ownCopyOf = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
  copyId: string,
): Promise<Doc<"ownedPuzzles"> | null> => {
  const copy = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
    .unique();
  return copy?.ownerId === memberId ? copy : null;
};

/** The one refusal for a copy the caller can't share or unshare: missing, or not theirs. */
export const copyNotFound = (): ConvexError<{
  code: string;
  message: string;
}> =>
  new ConvexError({
    code: "CopyNotFound",
    message: "No such copy of yours",
  });
