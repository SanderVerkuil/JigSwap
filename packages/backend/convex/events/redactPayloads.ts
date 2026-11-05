import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { REDACTED_EVENT_FIELDS, redactPayload } from "./recordAndSchedule";

/** Events per batch: one read and at most one patch each. */
export const REDACT_PAYLOADS_BATCH = 500;

type Counts = { scanned: number; redacted: number };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// SEC-71 migration: events recorded before recordAndSchedule left REDACTED_EVENT_FIELDS out still
// carry them (comment text, copy notes, collection and category names, display names, emails and
// Clerk ids). This strips them from every row, dispatched or not: no subscriber reads them, so an
// event still in flight dispatches the same without them. Ids, `reason` and every other field
// stay.
//
// A DRY RUN by default: pass `dryRun: false` to write. Pages `domainEvents` and reschedules itself
// until the log is done, then logs the totals; idempotent (a stripped row has nothing left to
// strip). Returns this batch's counts. Run by an operator.
export const redactPayloads = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    totals: v.optional(v.object({ scanned: v.number(), redacted: v.number() })),
  },
  handler: async (ctx, args): Promise<Counts> => {
    const dryRun = args.dryRun ?? true;
    const page = await ctx.db.query("domainEvents").paginate({
      numItems: args.batchSize ?? REDACT_PAYLOADS_BATCH,
      cursor: args.cursor ?? null,
    });

    const batch: Counts = { scanned: 0, redacted: 0 };
    for (const event of page.page) {
      batch.scanned++;
      const payload: unknown = event.payload;
      if (!isPlainObject(payload)) continue;
      if (!Object.keys(payload).some((key) => REDACTED_EVENT_FIELDS.has(key))) {
        continue;
      }
      batch.redacted++;
      if (!dryRun) {
        await ctx.db.patch(event._id, { payload: redactPayload(payload) });
      }
    }

    const totals: Counts = {
      scanned: (args.totals?.scanned ?? 0) + batch.scanned,
      redacted: (args.totals?.redacted ?? 0) + batch.redacted,
    };
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.events.redactPayloads.redactPayloads,
        {
          dryRun,
          cursor: page.continueCursor,
          batchSize: args.batchSize,
          totals,
        },
      );
    } else {
      logEvent({
        event: "events.redactPayloads",
        outcome: "success",
        dry_run: dryRun,
        scanned: totals.scanned,
        redacted: totals.redacted,
      });
    }
    return batch;
  },
});
