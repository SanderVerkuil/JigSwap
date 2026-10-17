import { makeLeaveHousehold } from "@jigswap/domain";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the acting member leaves their household; their copies leave with them (the
// household rule is derived from membership). The last member leaving dissolves the household.
export const leaveHousehold = mutation({
  args: {},
  handler: async (ctx): Promise<{ dissolved: boolean }> => {
    const actorId = await requireMember(ctx);
    const result = await makeLeaveHousehold(householdDeps(ctx))({ actorId });
    if (result.isErr) throw toConvexError(result.error);
    return { dissolved: result.value.dissolved };
  },
});
