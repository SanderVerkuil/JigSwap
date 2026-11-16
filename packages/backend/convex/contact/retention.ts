import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  logRetentionSweep,
  RETENTION_SWEEP_PAGE,
  retentionEnforced,
} from "../lib/retention";

/**
 * How long a handled contact message is kept, counted from when it was sent (createdAt): the table
 * stores no handled time, and by_status orders handled messages by createdAt.
 */
export const CONTACT_MESSAGE_RETENTION_MONTHS = 12;

/**
 * The daily contactMessages retention sweep (crons.ts; ops-3, SEC-22): deletes every handled
 * contact message sent more than CONTACT_MESSAGE_RETENTION_MONTHS ago, one page per run over
 * by_status, re-scheduling itself until the backlog is done. A dry run, counting only, unless
 * RETENTION_ENFORCE is "all" or names "contactMessages" (lib/retention: "all" leaves out only
 * copyPhotos). A message still "new" is never read.
 */
export const sweepContactMessageRetention = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - CONTACT_MESSAGE_RETENTION_MONTHS);
    const enforce = retentionEnforced("contactMessages");
    // shortcut: a dry run re-reads every due message daily (CONTACT_BUDGET caps arrivals at 100 a
    // day); cap its pages like events/retention if the dry run stays on for long.
    const page = await ctx.db
      .query("contactMessages")
      .withIndex("by_status", (q) =>
        q.eq("status", "handled").lt("createdAt", cutoff.getTime()),
      )
      .paginate({
        numItems: RETENTION_SWEEP_PAGE,
        cursor: args.cursor ?? null,
      });
    if (enforce) {
      for (const message of page.page) await ctx.db.delete(message._id);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.contact.retention.sweepContactMessageRetention,
        { cursor: page.continueCursor, now },
      );
    }
    logRetentionSweep({
      sweep: "contactMessages",
      due: page.page.length,
      acted: enforce ? page.page.length : 0,
      dryRun: !enforce,
      isDone: page.isDone,
    });
  },
});
