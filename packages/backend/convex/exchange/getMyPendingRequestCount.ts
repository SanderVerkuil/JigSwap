import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";

// How far the phone chrome's badge counts. It shows on every page, so past this it stops reading.
const PENDING_COUNT_CAP = 100;

// Exchange read: how many requests the signed-in member received that still wait for their answer,
// for the phone chrome's Swaps badge. The rows of that one range and nothing they join, so an
// exchange changing elsewhere doesn't re-run it. At most PENDING_COUNT_CAP. 0 when unauthenticated,
// unknown or deactivated.
export const getMyPendingRequestCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const me = await optionalActingMember(ctx);
    if (!me) return 0;
    const rows = await ctx.db
      .query("exchanges")
      .withIndex("by_recipient_status_created", (q) =>
        q.eq("recipientId", me).eq("status", "proposed"),
      )
      .take(PENDING_COUNT_CAP);
    return rows.length;
  },
});
