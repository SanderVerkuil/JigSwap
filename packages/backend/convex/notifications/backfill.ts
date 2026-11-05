import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";

// One-shot migration: legacy notifications predate aggregateId + channel, so the domain path
// (which keys saves on aggregateId and carries a channel) can't act on them. Stamp a fresh
// NotificationId + the default "inApp" channel on every row still missing them. Idempotent: rows
// already carrying both are skipped, so re-running is safe.
export const backfillNotificationFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const notifications = await ctx.db.query("notifications").collect();

    let patched = 0;
    for (const notification of notifications) {
      const patch: { aggregateId?: string; channel?: string } = {};
      if (!notification.aggregateId) patch.aggregateId = crypto.randomUUID();
      if (!notification.channel) patch.channel = "inApp";
      if (Object.keys(patch).length === 0) continue;
      await ctx.db.patch(notification._id, patch);
      patched++;
    }

    return { patched };
  },
});

// Rows per batch: one read and at most one patch each.
export const STRIP_ACTOR_NAMES_BATCH = 100;

type StripCounts = {
  scanned: number;
  stripped: number;
  keptUnattributed: number;
};

// SEC-68 migration: the subscriber used to copy the actor's display name into the recipient's row
// (`params.actorName`). That copy outlived the actor's account deletion and their renames. New
// rows carry the actor as a ref only; this strips the copy from older rows.
//
// A row WITH actor refs never shows its snapshot (the bell, email and push resolve the ref), so
// stripping it changes nothing a member sees. A row WITHOUT refs shows only its snapshot; stripping
// it makes that row fall back to the generic "Someone" copy, so it is opt-in
// (`includeUnattributed`, an owner decision). A DRY RUN by default: pass `dryRun: false` to write.
// Pages through `notifications` and reschedules itself; idempotent (a stripped row has no
// actorName left to strip).
export const stripActorNameSnapshots = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    includeUnattributed: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        stripped: v.number(),
        keptUnattributed: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<StripCounts> => {
    const dryRun = args.dryRun ?? true;
    const includeUnattributed = args.includeUnattributed ?? false;
    const page = await ctx.db.query("notifications").paginate({
      numItems: STRIP_ACTOR_NAMES_BATCH,
      cursor: args.cursor ?? null,
    });

    const batch: StripCounts = { scanned: 0, stripped: 0, keptUnattributed: 0 };
    for (const row of page.page) {
      batch.scanned++;
      if (row.params?.actorName === undefined) continue;
      if ((row.actorIds ?? []).length === 0 && !includeUnattributed) {
        batch.keptUnattributed++;
        continue;
      }
      batch.stripped++;
      if (dryRun) continue;
      const { actorName: _name, ...params } = row.params;
      await ctx.db.patch(row._id, {
        params: Object.keys(params).length > 0 ? params : undefined,
      });
    }

    const totals: StripCounts = {
      scanned: (args.totals?.scanned ?? 0) + batch.scanned,
      stripped: (args.totals?.stripped ?? 0) + batch.stripped,
      keptUnattributed:
        (args.totals?.keptUnattributed ?? 0) + batch.keptUnattributed,
    };
    logEvent({
      event: "notifications.stripActorNameSnapshots",
      outcome: "success",
      dry_run: dryRun,
      include_unattributed: includeUnattributed,
      batch,
      totals,
      is_done: page.isDone,
    });

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.backfill.stripActorNameSnapshots,
        {
          cursor: page.continueCursor,
          dryRun,
          includeUnattributed,
          totals,
        },
      );
    }
    return batch;
  },
});
