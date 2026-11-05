import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { canManageCopy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";

// Resolve a copy's domain id (the aggregateId acquireCopy returns) to the ownedPuzzles _id the
// copy page (/my-puzzles/<id>) is keyed on, so the add flow can land on the new copy. Only a
// member who may manage the copy (owner, or a household member at "manage") gets the id; anyone
// else gets null, the same answer as for an unknown id, so this is no existence oracle.
export const getCopyDocId = query({
  args: { copyId: v.string() },
  handler: async (ctx, args): Promise<Id<"ownedPuzzles"> | null> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.copyId))
      .unique();
    if (!copy) return null;
    if (!(await canManageCopy(ctx, memberId, copy))) return null;
    return copy._id;
  },
});
