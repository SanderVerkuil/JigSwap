import type { MyHouseholdJoinRequestView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { personView } from "./getMyHousehold";
import { isOpenForRequester } from "./joinRequestReads";

// The viewer's own open request to join a household, or null. Open = waiting (a silently declined
// or dropped request reads the same), not lapsed, and still matching the household they agreed to
// leave. `inviter` is the admin whose link they asked from.
export const myJoinRequest = query({
  args: {},
  handler: async (ctx): Promise<MyHouseholdJoinRequestView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const rows = [];
    for (const status of ["pending", "declined"] as const) {
      rows.push(
        ...(await ctx.db
          .query("householdJoinRequests")
          .withIndex("by_requester", (q) =>
            q.eq("requesterId", viewerId).eq("status", status),
          )
          .collect()),
      );
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    for (const row of rows) {
      if (!(await isOpenForRequester(ctx, row, now))) continue;
      return {
        requestId: row.aggregateId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        inviter: await personView(ctx, row.adminId),
      };
    }
    return null;
  },
});
