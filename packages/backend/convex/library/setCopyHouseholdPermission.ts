import { householdPermissionChange, toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { toConvexError } from "../household/errors";
import { requireMember } from "../identity/requireMember";

// The copy's OWNER chooses what their household may do with it: "manage" (act as co-owner) or
// "view" (see it only). Owner-only (the domain's householdPermissionChange rule, shared with the
// bulk setCopiesHouseholdPermission). Stored on the row; absent means "manage".
export const setCopyHouseholdPermission = mutation({
  args: {
    copyId: v.id("ownedPuzzles"),
    permission: v.union(v.literal("manage"), v.literal("view")),
  },
  handler: async (ctx, args): Promise<void> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const copy = await ctx.db.get(args.copyId);
    if (!copy) throw new ConvexError("Copy not found");
    const change = householdPermissionChange(
      { ...copy, ownerId: toMemberId(copy.ownerId) },
      toMemberId(memberId),
      args.permission,
    );
    if (change.isErr) throw toConvexError(change.error);
    await ctx.db.patch(copy._id, {
      householdPermission: args.permission,
      updatedAt: Date.now(),
    });
  },
});
