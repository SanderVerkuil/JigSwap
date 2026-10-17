import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { copyAccessOf } from "../household/copyAccess";

// The copy gate for logging a FINISHED solve on a copy, shared by recordCompletion and
// recordPastCompletions: resolve the copy by its Library aggregateId, then allow the owner, the
// current holder (borrower), or any household member (view or manage). The solve is the logger's
// own — completions are personal and never shared with the household. Throws for anyone else.
export const loadSolvableCopy = async (
  ctx: MutationCtx,
  me: Id<"users">,
  copyAggregateId: string,
): Promise<Doc<"ownedPuzzles">> => {
  const copy = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyAggregateId))
    .unique();
  if (!copy) throw new ConvexError("Copy not found");
  if (
    copy.ownerId !== me &&
    copy.heldBy !== me &&
    (await copyAccessOf(ctx, me, copy)) === "none"
  ) {
    throw new ConvexError(
      "Only the owner, current holder or a household member can log a solve for this copy",
    );
  }
  return copy;
};
