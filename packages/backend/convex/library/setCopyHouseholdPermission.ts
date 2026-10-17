import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// The copy's OWNER chooses what their household may do with it: "manage" (act as co-owner) or
// "view" (see it only). Owner-only — a household manager may NOT change it (that would let them
// escalate or lock out the owner's choice). Stored on the row; absent means "manage".
export const setCopyHouseholdPermission = mutation({
  args: {
    copyId: v.id("ownedPuzzles"),
    permission: v.union(v.literal("manage"), v.literal("view")),
  },
  handler: async (ctx, args): Promise<void> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const copy = await ctx.db.get(args.copyId);
    if (!copy) throw new ConvexError("Copy not found");
    if (copy.ownerId !== memberId) {
      throw new ConvexError(
        "Only the owner can change this copy's household access",
      );
    }
    await ctx.db.patch(copy._id, {
      householdPermission: args.permission,
      updatedAt: Date.now(),
    });
  },
});
