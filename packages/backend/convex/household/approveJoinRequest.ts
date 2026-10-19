import {
  makeApproveHouseholdJoinRequest,
  toHouseholdJoinRequestId,
  type HouseholdJoinRequestOutcome,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isBlockedEitherWay } from "../social/blocks";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household's admin approves a request to join (NotHouseholdAdmin for
// anyone else). "joined": the requester left their household (as they consented) and joined, in
// this transaction. "closed": the request can no longer be approved, for any reason (withdrawn,
// declined, lapsed, blocked, or the requester's household no longer matches their consent, which
// voids it); one answer, so the admin never learns which.
export const approveJoinRequest = mutation({
  args: { requestId: v.string() },
  handler: async (
    ctx,
    { requestId },
  ): Promise<{ outcome: HouseholdJoinRequestOutcome }> => {
    const actorId = await requireMember(ctx);
    const row = await ctx.db
      .query("householdJoinRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", requestId))
      .unique();
    const approveUseCase = makeApproveHouseholdJoinRequest(householdDeps(ctx));
    const result = await approveUseCase({
      actorId,
      requestId: toHouseholdJoinRequestId(requestId),
      blocked:
        row !== null &&
        (await isBlockedEitherWay(
          ctx,
          actorId as unknown as Id<"users">,
          row.requesterId,
        )),
    });
    if (result.isErr) throw toConvexError(result.error);
    return { outcome: result.value };
  },
});
