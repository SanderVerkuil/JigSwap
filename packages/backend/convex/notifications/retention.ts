import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { DAY_MS, logRetentionSweep, retentionEnforced } from "../lib/retention";

// Retention for in-app notifications (P-31 B proposal, awaiting the owner): a READ notification
// expires 180 days after its last activity, any notification 365 days after it. Last activity is
// when a grouped row last absorbed an actor (updatedAt), else when it was created.
//
// SHIPS AS A DRY RUN. The weekly cron (crons.ts) passes mode "dry-run": the sweep only counts what
// it would delete and logs one wide event per run, also forwarded to Axiom. Because counting never
// shrinks the backlog, a dry run stops after DRY_RUN_MAX_PAGES and reports a capped sample of the
// OLDEST rows instead of re-reading every old notification each week. Deleting needs the owner to
// approve the periods and add the matching retention line to the privacy policy (EN/NL), then
// switch the cron's mode to "delete" in the same change (notificationRetention.test.ts pins it).
// That change alone deletes nothing: RETENTION_ENFORCE must also name "notifications" or be "all"
// (lib/retention, the switch every retention sweep shares). Equally, "all" set for the other sweeps
// deletes nothing here while the cron passes "dry-run".

export const READ_RETENTION_DAYS = 180;
export const UNREAD_RETENTION_DAYS = 365;

/** Notifications read per run (one page); the sweep reschedules itself for the next page. */
export const RETENTION_SWEEP_PAGE = 200;

/**
 * A dry run stops after this many pages (2000 rows) and reports `capped`; its counts are then a
 * lower bound taken from the oldest rows. Delete mode is not capped: it removes what it counts, so
 * the backlog it reads only shrinks.
 */
export const DRY_RUN_MAX_PAGES = 10;

const modeValidator = v.union(v.literal("dry-run"), v.literal("delete"));

type Totals = {
  pages: number;
  scanned: number;
  expiredRead: number;
  expiredUnread: number;
};

const isExpired = (row: Doc<"notifications">, asOf: number): boolean => {
  const lastActivity = row.updatedAt ?? row.createdAt;
  if (lastActivity < asOf - UNREAD_RETENTION_DAYS * DAY_MS) return true;
  return row.isRead && lastActivity < asOf - READ_RETENTION_DAYS * DAY_MS;
};

/**
 * Sweep one page of notifications created before the read-retention cutoff (by_created_at), count
 * the expired ones and, in "delete" mode with RETENTION_ENFORCE on, delete them; then schedule the
 * next page (a dry run stops after DRY_RUN_MAX_PAGES). The cron starts it with just a mode; `asOf`
 * is fixed at the start so every page of a run reads the same range, and `totals` carries the
 * running counts into the single per-run wide event logged at the end. Each page also logs the
 * `retention.sweep` event all retention sweeps share.
 */
export const sweepExpiredNotifications = internalMutation({
  args: {
    mode: v.optional(modeValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    asOf: v.optional(v.number()),
    totals: v.optional(
      v.object({
        pages: v.number(),
        scanned: v.number(),
        expiredRead: v.number(),
        expiredUnread: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Totals & { isDone: boolean; capped: boolean }> => {
    const mode =
      args.mode === "delete" && retentionEnforced("notifications")
        ? "delete"
        : "dry-run";
    const asOf = args.asOf ?? Date.now();
    // Nothing created after this can have expired: last activity is never before creation.
    const createdBefore = asOf - READ_RETENTION_DAYS * DAY_MS;
    const page = await ctx.db
      .query("notifications")
      .withIndex("by_created_at", (q) => q.lt("createdAt", createdBefore))
      .paginate({
        numItems: RETENTION_SWEEP_PAGE,
        cursor: args.cursor ?? null,
      });

    const totals: Totals = {
      pages: (args.totals?.pages ?? 0) + 1,
      scanned: (args.totals?.scanned ?? 0) + page.page.length,
      expiredRead: args.totals?.expiredRead ?? 0,
      expiredUnread: args.totals?.expiredUnread ?? 0,
    };
    let due = 0;
    for (const row of page.page) {
      if (!isExpired(row, asOf)) continue;
      due++;
      if (row.isRead) totals.expiredRead++;
      else totals.expiredUnread++;
      if (mode === "delete") await ctx.db.delete(row._id);
    }

    // A dry run with rows left stops here and reports a sample (see DRY_RUN_MAX_PAGES).
    const capped =
      mode === "dry-run" && !page.isDone && totals.pages >= DRY_RUN_MAX_PAGES;
    logRetentionSweep({
      sweep: "notifications",
      due,
      acted: mode === "delete" ? due : 0,
      dryRun: mode !== "delete",
      isDone: page.isDone || capped,
    });
    if (!page.isDone && !capped) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.retention.sweepExpiredNotifications,
        { mode, cursor: page.continueCursor, asOf, totals },
      );
    } else {
      const expired = totals.expiredRead + totals.expiredUnread;
      const line = logEvent({
        event: "notifications.retentionSweep",
        outcome: "success",
        mode,
        as_of: asOf,
        read_retention_days: READ_RETENTION_DAYS,
        unread_retention_days: UNREAD_RETENTION_DAYS,
        pages: totals.pages,
        scanned: totals.scanned,
        // True when a dry run stopped at DRY_RUN_MAX_PAGES: the counts are a lower bound.
        capped,
        expired_read: totals.expiredRead,
        expired_unread: totals.expiredUnread,
        // In a dry run this is what WOULD be deleted; `deleted` stays 0.
        expired_total: expired,
        deleted: mode === "delete" ? expired : 0,
      });
      // Mutations cannot reach Axiom (Node-only SDK), and the deployment log is not streamed
      // anywhere (lib/axiom): hand the line to the Node forwarder so the owner can read the counts.
      await ctx.scheduler.runAfter(
        0,
        internal.events.ingestDispatchFailure.ingest,
        { line },
      );
    }
    return { ...totals, isDone: page.isDone, capped };
  },
});
