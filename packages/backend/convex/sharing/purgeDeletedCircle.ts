import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

// How many circleCopyShares links one purge run deletes before rescheduling itself.
export const PURGE_BATCH_SIZE = 200;

// Scheduled by the sharing publisher on CircleDeleted. The circle, its memberships and its invites
// went in the deleting transaction; what is left can be large, so it goes here in batches that
// reschedule themselves until none remain. It is hygiene, not access control: every reader gates
// on membership, which is already gone, so these rows are unreachable while they wait.
//
// Evidence holds: nothing under this circle can be held yet (there is no reports table or
// `evidenceHold` field on this branch). When circle chats land (G4), the circle's thread is purged
// here too: delete its participant and typing rows, and its messages and attachments EXCEPT those
// with `evidenceHold` set, which are detached from the thread and kept (reachable only through
// their report); report snapshots are never touched.
export const purgeDeletedCircle = internalMutation({
  args: { circleId: v.string() },
  handler: async (ctx, args): Promise<number> => {
    const shares = await ctx.db
      .query("circleCopyShares")
      .withIndex("by_circle", (q) => q.eq("circleId", args.circleId))
      .take(PURGE_BATCH_SIZE);
    for (const share of shares) await ctx.db.delete(share._id);

    if (shares.length === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.sharing.purgeDeletedCircle.purgeDeletedCircle,
        args,
      );
    }
    return shares.length;
  },
});
