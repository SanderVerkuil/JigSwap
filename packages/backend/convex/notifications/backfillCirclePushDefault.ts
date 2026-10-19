import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

// Preference rows per batch. Each row is one read and at most one patch.
export const BACKFILL_CIRCLE_PUSH_DEFAULT_BATCH = 200;
export const BACKFILL_CIRCLE_PUSH_DEFAULT_MAX_BATCH = 500;

type Counts = { scanned: number; reset: number };

// Is this the untouched old default triple {inApp: true, email: false, push: true}? Compared field
// by field (Convex re-sorts object keys on write, so a serialised comparison is not reliable), and
// only those three keys: any other shape means the member changed something.
const isOldDefault = (triple: unknown): boolean => {
  if (typeof triple !== "object" || triple === null) return false;
  const t = triple as Record<string, unknown>;
  return (
    Object.keys(t).length === 3 &&
    t.inApp === true &&
    t.email === false &&
    t.push === true
  );
};

// One-shot, idempotent reset for #292. While circle message push was on by default (#278), every
// preference row materialised in that window stored `circle_message_received` as the full default
// triple {inApp: true, email: false, push: true}, indistinguishable from a choice. This removes the
// `push` key from exactly that triple, so `allows` falls back to the new default (off). Any other
// triple is a member's own choice and is left alone; rows without the key already resolve to the
// new default. Edge case: a member who switched push off and on again is stored the same as the
// untouched default, so they are reset too.
//
// `updatedAt` is deliberately NOT bumped: this is not a member action, and the row's last real
// change stays visible. Pages through `notificationPreferences`, rescheduling itself until done;
// each batch is its own transaction. `dryRun` defaults to TRUE: it walks every page and counts
// without writing. Pass `dryRun: false` to apply. Re-running resets nothing new.
export const backfillCirclePushDefault = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(v.object({ scanned: v.number(), reset: v.number() })),
  },
  handler: async (
    ctx,
    { cursor, dryRun = true, batchSize, totals },
  ): Promise<Counts> => {
    const numItems = Math.max(
      1,
      Math.min(
        BACKFILL_CIRCLE_PUSH_DEFAULT_MAX_BATCH,
        Math.floor(batchSize ?? BACKFILL_CIRCLE_PUSH_DEFAULT_BATCH),
      ),
    );
    const page = await ctx.db
      .query("notificationPreferences")
      .paginate({ numItems, cursor: cursor ?? null });

    const batch: Counts = { scanned: 0, reset: 0 };
    for (const row of page.page) {
      batch.scanned++;
      const toggles = (row.toggles ?? {}) as Record<string, unknown>;
      if (!isOldDefault(toggles.circle_message_received)) continue;
      batch.reset++;
      if (dryRun) continue;
      await ctx.db.patch(row._id, {
        toggles: {
          ...toggles,
          circle_message_received: { inApp: true, email: false },
        },
      });
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      reset: (totals?.reset ?? 0) + batch.reset,
    };
    console.log(
      `notifications/backfillCirclePushDefault${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.backfillCirclePushDefault
          .backfillCirclePushDefault,
        {
          cursor: page.continueCursor,
          totals: runTotals,
          dryRun,
          ...(batchSize !== undefined ? { batchSize } : {}),
        },
      );
    }
    return batch;
  },
});
