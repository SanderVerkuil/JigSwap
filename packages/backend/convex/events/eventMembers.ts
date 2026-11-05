import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { logEvent } from "../lib/logEvent";

// The event -> member lookup (domainEventMembers, PERF-B7 / SEC-71): which members each recorded
// event names, so the account purge reads a member's events by index instead of paging the whole
// log. recordAndSchedule writes the rows with every event; backfillEventMembers adds them for
// events recorded before, then writes the EVENT_MEMBERS_BACKFILL marker. Code that relies on the
// lookup being complete checks eventMembersBackfilled first.

/** The backfillMarkers name backfillEventMembers writes once every older event has its rows. */
export const EVENT_MEMBERS_BACKFILL = "domainEventMembers";

/** Events per backfill batch: one index read and a few inserts each. */
export const BACKFILL_EVENT_MEMBERS_BATCH = 200;

// Every string anywhere in an event payload.
const stringsIn = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
};

/** The distinct users ids anywhere in `payload` (an id field, an array of ids, a nested value). */
export const memberIdsIn = (ctx: QueryCtx, payload: unknown): Id<"users">[] => [
  ...new Set(
    stringsIn(payload)
      .map((s) => ctx.db.normalizeId("users", s))
      .filter((id): id is Id<"users"> => id !== null),
  ),
];

/** One lookup row per member the event's payload names. */
export const recordEventMembers = async (
  ctx: MutationCtx,
  eventId: Id<"domainEvents">,
  payload: unknown,
): Promise<void> => {
  for (const memberId of memberIdsIn(ctx, payload)) {
    await ctx.db.insert("domainEventMembers", { eventId, memberId });
  }
};

/** Delete the event's lookup rows: all of them, or only `memberId`'s. */
export const deleteEventMembers = async (
  ctx: MutationCtx,
  eventId: Id<"domainEvents">,
  memberId?: Id<"users">,
): Promise<void> => {
  const rows = await ctx.db
    .query("domainEventMembers")
    .withIndex("by_event", (q) =>
      memberId === undefined
        ? q.eq("eventId", eventId)
        : q.eq("eventId", eventId).eq("memberId", memberId),
    )
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
};

/** Whether every event recorded before the lookup existed has its rows (the backfill finished). */
export const eventMembersBackfilled = async (ctx: QueryCtx): Promise<boolean> =>
  (await ctx.db
    .query("backfillMarkers")
    .withIndex("by_name", (q) => q.eq("name", EVENT_MEMBERS_BACKFILL))
    .first()) !== null;

type Counts = { scanned: number; added: number };

// Backfill the lookup for every event recorded before it existed: each event gets one row per
// member its payload names that it does not have yet (so re-running adds nothing, and an event
// recordAndSchedule wrote meanwhile is left as it is). When the last page is done it writes the
// EVENT_MEMBERS_BACKFILL marker, from which on the account purge reads by index.
//
// A DRY RUN by default (counts only, no rows and no marker): pass `dryRun: false` to write. Pages
// `domainEvents` and reschedules itself; logs the totals at the end. Run by an operator.
export const backfillEventMembers = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    totals: v.optional(v.object({ scanned: v.number(), added: v.number() })),
  },
  handler: async (ctx, args): Promise<Counts> => {
    const dryRun = args.dryRun ?? true;
    const page = await ctx.db.query("domainEvents").paginate({
      numItems: args.batchSize ?? BACKFILL_EVENT_MEMBERS_BATCH,
      cursor: args.cursor ?? null,
    });

    const batch: Counts = { scanned: 0, added: 0 };
    for (const event of page.page) {
      batch.scanned++;
      const named = memberIdsIn(ctx, event.payload);
      if (named.length === 0) continue;
      const existing = await ctx.db
        .query("domainEventMembers")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      const have = new Set<string>(existing.map((row) => row.memberId));
      for (const memberId of named) {
        if (have.has(memberId)) continue;
        batch.added++;
        if (!dryRun) {
          await ctx.db.insert("domainEventMembers", {
            eventId: event._id,
            memberId,
          });
        }
      }
    }

    const totals: Counts = {
      scanned: (args.totals?.scanned ?? 0) + batch.scanned,
      added: (args.totals?.added ?? 0) + batch.added,
    };
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.events.eventMembers.backfillEventMembers,
        {
          dryRun,
          cursor: page.continueCursor,
          batchSize: args.batchSize,
          totals,
        },
      );
      return batch;
    }
    if (!dryRun && !(await eventMembersBackfilled(ctx))) {
      await ctx.db.insert("backfillMarkers", {
        name: EVENT_MEMBERS_BACKFILL,
        completedAt: Date.now(),
      });
    }
    logEvent({
      event: "events.backfillEventMembers",
      outcome: "success",
      dry_run: dryRun,
      scanned: totals.scanned,
      added: totals.added,
    });
    return batch;
  },
});
