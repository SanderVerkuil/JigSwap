import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { purgeCircleThreadBatch } from "../conversation/purgeCircleThread";

// How many rows (copy-share links, then invites, then the circle thread's rows) one purge run
// deletes before rescheduling itself.
export const PURGE_BATCH_SIZE = 200;

// Scheduled by the sharing publisher on CircleDeleted. The circle, its memberships and its pending
// invites went in the deleting transaction; what is left (its circleCopyShares links, its decided
// invites, and the circle's group thread) can be large, so it goes here in batches that reschedule
// themselves until none remain. It is hygiene, not access control: every reader gates on
// membership, which is already gone, so these rows are unreachable while they wait.
//
// The circle thread (conversation/purgeCircleThread): its messages, attachments, typing and
// participant rows, then the thread row. Attachments under an open report's `evidenceHold` (and
// quarantined photos) are kept, detached from the deleted thread and reachable only through their
// report; report snapshots are never touched.
export const purgeDeletedCircle = internalMutation({
  args: { circleId: v.string() },
  handler: async (ctx, args): Promise<number> => {
    // Defensive: only ever purge a circle that is actually gone. A live circle's links and invites
    // are its state, not leftovers, whoever scheduled this.
    const live = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.circleId))
      .first();
    if (live) return 0;

    const shares = await ctx.db
      .query("circleCopyShares")
      .withIndex("by_circle", (q) => q.eq("circleId", args.circleId))
      .take(PURGE_BATCH_SIZE);
    for (const share of shares) await ctx.db.delete(share._id);

    // Fill the rest of the batch with invites of any status.
    const invites =
      shares.length < PURGE_BATCH_SIZE
        ? await ctx.db
            .query("circleInvites")
            .withIndex("by_circle_invitee", (q) =>
              q.eq("circleAggregateId", args.circleId),
            )
            .take(PURGE_BATCH_SIZE - shares.length)
        : [];
    for (const invite of invites) await ctx.db.delete(invite._id);

    const linked = shares.length + invites.length;
    const deleted =
      linked +
      (await purgeCircleThreadBatch(
        ctx,
        args.circleId,
        PURGE_BATCH_SIZE - linked,
      ));
    if (deleted >= PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.sharing.purgeDeletedCircle.purgeDeletedCircle,
        args,
      );
    }
    return deleted;
  },
});
