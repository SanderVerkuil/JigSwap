import type { MutationCtx } from "../../_generated/server";

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
