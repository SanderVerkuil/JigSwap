import { makeRenameHousehold, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household ADMIN names THEIR household, or clears the name with null
// (admin-only and the 1-100 character rule are enforced by the aggregate; no household →
// NotInHousehold). Only getMyHousehold returns the name, so only members ever see it.
export const renameHousehold = mutation({
  args: { name: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const result = await makeRenameHousehold(householdDeps(ctx))({
      actorId: toMemberId(actorId),
      name: args.name,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
