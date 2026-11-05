import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import {
  ACTIVITY_READ_MODEL,
  FEED_EVENT_NAMES,
  FEED_WINDOW_MS,
  projectActivityEvent,
} from "./activityEntries";

// Events per batch. Each costs at most an exchange lookup plus, per actor (two for an exchange),
// a users read, an index lookup and one write. `batchSize` overrides it, floored and clamped to
// 1..MAX, which stays far below Convex's per-mutation read and write limits.
export const BACKFILL_ACTIVITY_ENTRIES_BATCH = 200;
export const BACKFILL_ACTIVITY_ENTRIES_MAX_BATCH = 1000;

type Counts = { events: number; inserted: number; updated: number };

const feedEventName = v.union(
  v.literal("CompletionRecorded"),
  v.literal("CompletionStarted"),
  v.literal("CopyAcquired"),
  v.literal("ExchangeCompleted"),
);

// One-shot, idempotent backfill of the activity read model (SEC-30, PERF-B3m) from the events
// recorded before the dispatcher projected them. Walks the feed's four event names in turn through
// `domainEvents.by_name`, within the feed's window (FEED_WINDOW_MS before the run started; older
// events never reach a feed), one page per batch, rescheduling itself until the last name is
// exhausted. Each event goes through the dispatcher's own projectActivityEvent, so rows the
// dispatcher already wrote are left as they are and a re-run writes nothing. The last batch of a
// real run writes the readModelStatus row, which switches social/getActivityFeed from its legacy
// path to the read model. `dryRun` walks and counts without writing; it cannot see rows it did not
// write, so it counts a batch's later copies as inserts. Runbook: docs/deployment/one-shot-migrations.md.
export const backfillActivityEntries = internalMutation({
  args: {
    name: v.optional(feedEventName),
    cursor: v.optional(v.union(v.string(), v.null())),
    // The window's start, fixed by the first batch so every batch pages the same range.
    since: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        events: v.number(),
        inserted: v.number(),
        updated: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    { name, cursor, since, dryRun, batchSize, totals },
  ): Promise<Counts> => {
    const current = name ?? FEED_EVENT_NAMES[0];
    const windowStart = since ?? Date.now() - FEED_WINDOW_MS;
    const numItems = Math.max(
      1,
      Math.min(
        BACKFILL_ACTIVITY_ENTRIES_MAX_BATCH,
        Math.floor(batchSize ?? BACKFILL_ACTIVITY_ENTRIES_BATCH),
      ),
    );
    const page = await ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) =>
        q.eq("name", current).gte("occurredAt", windowStart),
      )
      .paginate({ numItems, cursor: cursor ?? null });

    const batch: Counts = { events: 0, inserted: 0, updated: 0 };
    for (const event of page.page) {
      batch.events++;
      const written = await projectActivityEvent(ctx, event, { dryRun });
      batch.inserted += written.inserted;
      batch.updated += written.updated;
    }
    const runTotals: Counts = {
      events: (totals?.events ?? 0) + batch.events,
      inserted: (totals?.inserted ?? 0) + batch.inserted,
      updated: (totals?.updated ?? 0) + batch.updated,
    };

    const next = page.isDone
      ? FEED_EVENT_NAMES[FEED_EVENT_NAMES.indexOf(current) + 1]
      : current;
    logEvent({
      event: "social.backfillActivityEntries",
      outcome: "success",
      dry_run: dryRun ?? false,
      event_name: current,
      batch,
      totals: runTotals,
      is_done: next === undefined,
    });

    if (next === undefined) {
      if (!dryRun) {
        const status = await ctx.db
          .query("readModelStatus")
          .withIndex("by_name", (q) => q.eq("name", ACTIVITY_READ_MODEL))
          .unique();
        if (status) {
          await ctx.db.patch(status._id, { completedAt: Date.now() });
        } else {
          await ctx.db.insert("readModelStatus", {
            name: ACTIVITY_READ_MODEL,
            completedAt: Date.now(),
          });
        }
      }
      return batch;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.social.backfillActivityEntries.backfillActivityEntries,
      {
        name: next,
        ...(next === current && { cursor: page.continueCursor }),
        since: windowStart,
        totals: runTotals,
        ...(batchSize !== undefined && { batchSize }),
        ...(dryRun && { dryRun }),
      },
    );
    return batch;
  },
});
