import { makeCreateHousehold } from "@jigswap/domain";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the acting member founds a household and becomes its admin. Rejected when they
// already belong to one (AlreadyInHousehold). Returns the HouseholdId.
export const createHousehold = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const actorId = await requireMember(ctx);
    const result = await makeCreateHousehold(householdDeps(ctx))({ actorId });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
