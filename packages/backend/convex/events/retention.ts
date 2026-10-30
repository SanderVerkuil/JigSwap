import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { DAY_MS, logRetentionSweep, retentionEnforced } from "../lib/retention";
import { FEED_WINDOW_MS } from "../social/activityEntries";
import { deleteEventMembers } from "./eventMembers";

/**
 * How long a dispatched domain event is kept: the activity feed's window (the only read of past
 * events, social/getActivityFeed) plus a week of margin. Must stay above FEED_WINDOW_MS, or the
 * feed loses entries it still shows.
 */
export const EVENT_RETENTION_MS = FEED_WINDOW_MS + 7 * DAY_MS;

/** Events a sweep run reads; it re-schedules itself for the next page. */
export const EVENT_RETENTION_PAGE = 500;

/**
 * The daily domainEvents retention sweep (crons.ts; SEC-71, PERF-B7): deletes every event that
 * was dispatched (processedAt) more than EVENT_RETENTION_MS ago, with its member lookup rows
 * (events/eventMembers), one page per run over by_processed, re-scheduling itself until the
 * backlog is done. A dry run, counting only, unless RETENTION_ENFORCE names "domainEvents"
 * (lib/retention). An event still in flight or terminally failed (failedAt, kept for an operator's
 * replay) has no processedAt and is never read; an event that occurred inside the window is kept
 * whatever its processedAt.
 */
export const sweepEventRetention = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const cutoff = now - EVENT_RETENTION_MS;
    const enforce = retentionEnforced("domainEvents");
    const page = await ctx.db
      .query("domainEvents")
      .withIndex("by_processed", (q) =>
        q.gte("processedAt", 0).lt("processedAt", cutoff),
      )
      .paginate({
        numItems: EVENT_RETENTION_PAGE,
        cursor: args.cursor ?? null,
      });
    let due = 0;
    let acted = 0;
    for (const event of page.page) {
      if (event.failedAt !== undefined || event.occurredAt >= cutoff) continue;
      due++;
      if (!enforce) continue;
      await deleteEventMembers(ctx, event._id);
      await ctx.db.delete(event._id);
      acted++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.events.retention.sweepEventRetention,
        { cursor: page.continueCursor, now },
      );
    }
    logRetentionSweep({
      sweep: "domainEvents",
      due,
      acted,
      dryRun: !enforce,
      isDone: page.isDone,
    });
  },
});
