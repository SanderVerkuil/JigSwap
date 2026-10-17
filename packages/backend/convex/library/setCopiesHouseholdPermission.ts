import {
  dedupeHouseholdPermissionBatch,
  HouseholdApplicationError,
  planHouseholdPermissionBatch,
  storedHouseholdPermission,
  toMemberId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { toConvexError } from "../household/errors";
import { membershipOf } from "../household/memberships";
import { requireMember } from "../identity/requireMember";

// Bulk form of setCopyHouseholdPermission, from the household page. The caller must be in a
// household and OWN every copy in the batch; one foreign or missing copy rejects the whole batch
// before anything is written (one mutation = one transaction, so it is all-or-nothing). Ids are
// deduped and capped; copies whose stored value already matches the choice are not rewritten.
export const setCopiesHouseholdPermission = mutation({
  args: {
    copyIds: v.array(v.id("ownedPuzzles")),
    // "default" clears the explicit value so the copy follows the household default.
    permission: v.union(
      v.literal("manage"),
      v.literal("view"),
      v.literal("default"),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ changed: number; unchanged: number }> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await membershipOf(ctx, memberId))) {
      throw toConvexError(HouseholdApplicationError.notInHousehold());
    }

    const ids = dedupeHouseholdPermissionBatch(args.copyIds);
    if (ids.isErr) throw toConvexError(ids.error);

    const copies = [];
    for (const id of ids.value) {
      const copy = await ctx.db.get(id);
      if (!copy) {
        throw new ConvexError({
          code: "CopyNotFound",
          message: "Copy not found",
        });
      }
      copies.push(copy);
    }

    const plan = planHouseholdPermissionBatch(
      copies.map((copy) => ({ ...copy, ownerId: toMemberId(copy.ownerId) })),
      toMemberId(memberId),
      args.permission,
    );
    if (plan.isErr) throw toConvexError(plan.error);

    const now = Date.now();
    for (const copy of plan.value.toChange) {
      await ctx.db.patch(copy._id, {
        householdPermission: storedHouseholdPermission(args.permission),
        updatedAt: now,
      });
    }
    return {
      changed: plan.value.toChange.length,
      unchanged: plan.value.unchanged,
    };
  },
});
