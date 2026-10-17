import { makeRemoveHouseholdMember, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household admin removes another member of THEIR household (admin-only and
// not-self are enforced by the aggregate). The removed member's copies leave with them.
export const removeHouseholdMember = mutation({
  args: { memberId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const result = await makeRemoveHouseholdMember(householdDeps(ctx))({
      actorId,
      memberId: toMemberId(args.memberId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
