import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type QueryCtx } from "../_generated/server";
import { logEvent } from "../lib/logEvent";

// The single platformStats row (schema.ts).
export const PLATFORM_STATS_KEY = "global";

// Rows per batch. `batchSize` overrides it, floored and clamped to 1..MAX. Each batch also stops
// once it has read RECOUNT_MAX_BYTES, so a run of oversized rows (a document can be up to 1 MiB)
// shortens the batch instead of failing it against Convex's per-transaction read limit.
export const RECOUNT_BATCH = 1000;
export const RECOUNT_MAX_BATCH = 4000;
const RECOUNT_MAX_BYTES = 4 * 1024 * 1024;

// The tables counted, in the order the recount walks them.
const TABLES = ["users", "puzzles", "ownedPuzzles"] as const;
type Table = (typeof TABLES)[number];
type Counts = Record<Table, number>;

const countedTable = v.union(
  v.literal("users"),
  v.literal("puzzles"),
  v.literal("ownedPuzzles"),
);

export const readPlatformStats = (
  ctx: QueryCtx,
): Promise<Doc<"platformStats"> | null> =>
  ctx.db
    .query("platformStats")
    .withIndex("by_key", (q) => q.eq("key", PLATFORM_STATS_KEY))
    .unique();

// Recounts the landing page's counters (PERF-B2m) into the platformStats row. Walks users, then
// puzzles, then ownedPuzzles, one page per invocation (Convex allows one paginate per function),
// carrying the running counts and rescheduling itself; the last batch writes the row. It counts
// every row of each table, the meaning the landing page always had (deactivated members and
// definitions in any status included). The walk spans several transactions, so rows written while
// it runs may or may not be counted; the next run picks them up. Runs on a cron (crons.ts) and
// doubles as the backfill: until its first run has written the row, getGlobalStats counts the
// tables itself. Runbook: docs/deployment/one-shot-migrations.md.
export const recount = internalMutation({
  args: {
    table: v.optional(countedTable),
    cursor: v.optional(v.union(v.string(), v.null())),
    // Running counts carried across batches.
    counts: v.optional(
      v.object({
        users: v.number(),
        puzzles: v.number(),
        ownedPuzzles: v.number(),
      }),
    ),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const current = args.table ?? TABLES[0];
    const numItems = Math.max(
      1,
      Math.min(RECOUNT_MAX_BATCH, Math.floor(args.batchSize ?? RECOUNT_BATCH)),
    );
    const page = await ctx.db.query(current).paginate({
      numItems,
      cursor: args.cursor ?? null,
      maximumBytesRead: RECOUNT_MAX_BYTES,
    });
    const counts: Counts = {
      users: args.counts?.users ?? 0,
      puzzles: args.counts?.puzzles ?? 0,
      ownedPuzzles: args.counts?.ownedPuzzles ?? 0,
    };
    counts[current] += page.page.length;

    const next = page.isDone ? TABLES[TABLES.indexOf(current) + 1] : current;
    if (next !== undefined) {
      await ctx.scheduler.runAfter(0, internal.insights.platformStats.recount, {
        table: next,
        ...(next === current && { cursor: page.continueCursor }),
        counts,
        ...(args.batchSize !== undefined && { batchSize: args.batchSize }),
      });
      return;
    }

    const countedAt = Date.now();
    const row = await readPlatformStats(ctx);
    if (row) {
      await ctx.db.patch(row._id, { ...counts, countedAt });
    } else {
      await ctx.db.insert("platformStats", {
        key: PLATFORM_STATS_KEY,
        ...counts,
        countedAt,
      });
    }
    logEvent({
      event: "insights.platformStats.recount",
      outcome: "success",
      counts,
      counted_at: countedAt,
    });
  },
});
