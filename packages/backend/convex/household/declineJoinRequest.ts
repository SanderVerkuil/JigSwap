import {
  makeDeclineHouseholdJoinRequest,
  toHouseholdJoinRequestId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household's admin declines a request to join (NotHouseholdAdmin for anyone
// else). Silent: the requester is not told and keeps seeing it as waiting until it lapses; the
// admin's notification resolves as declined.
export const declineJoinRequest = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }): Promise<null> => {
    const actorId = await requireMember(ctx);
    const declineUseCase = makeDeclineHouseholdJoinRequest(householdDeps(ctx));
    const result = await declineUseCase({
      actorId,
      requestId: toHouseholdJoinRequestId(requestId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return null;
  },
});
