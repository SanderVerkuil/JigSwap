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

/**
 * The shares of one circle a bounded read looks at: at most `budget`, each member's newest. A circle
 * within the budget gives them all, for one index range. A busier one goes round its members, each
 * taking an even part of what is left until the shares or the budget run out, so a member who shares
 * a lot takes what the others don't use and nothing they do. A share from before they named their
 * owner counts as one more member's, until sharing/backfillCircleShareOwners has run; it goes first, so
 * a circle's newest shares are read as ever until then. Past `2 * budget` lookups the rest of the
 * members wait (a viewer in so many busy circles that its budget per circle is smaller than a circle).
 */
export const sharesOfCircleWithin = async (
  ctx: QueryCtx,
  circleId: string,
  memberIds: readonly Id<"users">[],
  budget: number,
): Promise<Doc<"circleCopyShares">[]> => {
  const newest = await ctx.db
    .query("circleCopyShares")
    .withIndex("by_circle", (q) => q.eq("circleId", circleId))
    .order("desc")
    .take(budget + 1);
  if (newest.length <= budget) return newest;

  type Turn = { ownerId: Id<"users"> | undefined; before?: number };
  const shares: Doc<"circleCopyShares">[] = [];
  let waiting: Turn[] = [
    { ownerId: undefined },
    ...memberIds.map((ownerId) => ({ ownerId })),
  ];
  let lookups = 2 * budget;
  while (waiting.length > 0 && shares.length < budget && lookups > 0) {
    const left = budget - shares.length;
    const quota = Math.max(1, Math.floor(left / waiting.length));
    const turns = waiting.slice(0, Math.min(left, lookups));
    lookups -= turns.length;
    const rows = await Promise.all(
      turns.map(({ ownerId, before }) =>
        ctx.db
          .query("circleCopyShares")
          .withIndex("by_circle_owner", (q) => {
            const own = q.eq("circleId", circleId).eq("ownerId", ownerId);
            return before === undefined ? own : own.lt("_creationTime", before);
          })
          .order("desc")
          .take(quota),
      ),
    );
    shares.push(...rows.flat());
    // Whoever filled their quota may have more, and goes round again after those still waiting.
    waiting = [
      ...waiting.slice(turns.length),
      ...turns.flatMap(({ ownerId }, i) => {
        const last = rows[i][quota - 1];
        return last ? [{ ownerId, before: last._creationTime }] : [];
      }),
    ];
  }
  return shares;
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
