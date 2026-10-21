import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { logEvent } from "../logEvent";
import {
  moderationTableValidator,
  stampUnscored,
  type ModerationTable,
} from "./moderationPool";

// The daily backstop behind the moderation Workpool (crons.ts): a photo still "pending" more than
// STALLED_AFTER_MS after it was last touched is stamped "unscored" with reason "stalled", which
// puts it in the admin's Unchecked photos queue (Check again / approve / reject). The pool's own
// retries end within a few hours, so a row this old is one no check will ever decide: an attempt
// lost outside the pool (a retry scheduled before the pool existed, the box-art hand-off that never
// committed), or a pool job that disappeared.
//
// Every moderated table, message photos included, through its index on moderationStatus, ranged
// on _creationTime (an index's implicit last field), so only rows CREATED before the cutoff are
// read. Of those, a row touched since (updatedAt; box art: recheckedAt, set by an admin's "Check
// again") is left for a later run. One page per run, re-scheduling itself through the tables;
// stamping goes through each table's setVerdict (first verdict wins), so a run racing a late
// verdict, or a second run, changes nothing.

/** A row "pending" this long since it was last touched is stalled. */
export const STALLED_AFTER_MS = 24 * 60 * 60 * 1000;

/** Rows read per run. */
export const STALLED_SWEEP_PAGE = 100;

const TABLES: readonly ModerationTable[] = [
  "copy",
  "completion",
  "boxArt",
  "message",
  "circleIcon",
];

type Page = {
  rows: { id: string; pendingSince: number }[];
  isDone: boolean;
  continueCursor: string;
};

// One page of rows pending since before `cutoff` (by creation), with when each was last touched.
const pendingPage = async (
  ctx: MutationCtx,
  table: ModerationTable,
  cutoff: number,
  cursor: string | null,
): Promise<Page> => {
  const paginationOpts = { numItems: STALLED_SWEEP_PAGE, cursor };
  switch (table) {
    case "copy":
    case "completion": {
      const page = await ctx.db
        .query(table === "copy" ? "ownedPuzzleImages" : "completionImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "pending").lt("_creationTime", cutoff),
        )
        .paginate(paginationOpts);
      return {
        rows: page.page.map((row) => ({
          id: row._id,
          pendingSince: row.updatedAt,
        })),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }
    case "boxArt": {
      const page = await ctx.db
        .query("boxArtUploads")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "pending").lt("_creationTime", cutoff),
        )
        .paginate(paginationOpts);
      return {
        rows: page.page.map((row) => ({
          id: row._id,
          pendingSince: row.recheckedAt ?? row.createdAt,
        })),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }
    case "message":
    case "circleIcon": {
      const page = await ctx.db
        .query(table === "message" ? "messageAttachments" : "circleIcons")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "pending").lt("_creationTime", cutoff),
        )
        .paginate(paginationOpts);
      return {
        rows: page.page.map((row) => ({
          id: row._id,
          pendingSince: row.updatedAt,
        })),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }
  }
};

/**
 * Stamp one page of stalled rows (see the module comment), then schedule the next page, or the
 * next table. The cron starts it with no arguments; `cutoff` is fixed at the start so every page
 * of a run reads the same range.
 */
export const sweepStalledModeration = internalMutation({
  args: {
    table: v.optional(moderationTableValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    cutoff: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const table = args.table ?? TABLES[0];
    const cutoff = args.cutoff ?? Date.now() - STALLED_AFTER_MS;
    const page = await pendingPage(ctx, table, cutoff, args.cursor ?? null);
    const stampedIds: string[] = [];
    for (const row of page.rows) {
      if (row.pendingSince >= cutoff) continue;
      if (await stampUnscored(ctx, table, row.id, "stalled")) {
        stampedIds.push(row.id);
      }
    }

    const nextTable = TABLES[TABLES.indexOf(table) + 1];
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.stalledSweep.sweepStalledModeration,
        { table, cursor: page.continueCursor, cutoff },
      );
    } else if (nextTable !== undefined) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.stalledSweep.sweepStalledModeration,
        { table: nextTable, cursor: null, cutoff },
      );
    }
    // One wide event per page; error level when it stamped anything, so stalls are alertable.
    logEvent({
      event: "imageModeration.stalledSweep",
      outcome: stampedIds.length > 0 ? "error" : "success",
      table,
      cutoff,
      scanned: page.rows.length,
      stamped: stampedIds.length,
      stamped_image_ids: stampedIds,
      is_done: page.isDone && nextTable === undefined,
    });
  },
});
