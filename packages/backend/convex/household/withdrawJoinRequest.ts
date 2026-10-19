import {
  makeWithdrawHouseholdJoinRequest,
  toHouseholdJoinRequestId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { deleteNotificationsAbout } from "../invitations/fallbacks";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the requester withdraws their open request to join (a silently declined one
// too). The admin's notification about it goes, so they have nothing left to open.
export const withdrawJoinRequest = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }): Promise<null> => {
    const actorId = await requireMember(ctx);
    const withdrawUseCase = makeWithdrawHouseholdJoinRequest(
      householdDeps(ctx),
    );
    const result = await withdrawUseCase({
      actorId,
      requestId: toHouseholdJoinRequestId(requestId),
    });
    if (result.isErr) throw toConvexError(result.error);

    const row = await ctx.db
      .query("householdJoinRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", requestId))
      .unique();
    if (row !== null) {
      await deleteNotificationsAbout(
        ctx,
        row.adminId,
        "household_join_request_received",
        requestId,
      );
    }
    return null;
  },
});
