import type { ActivityKind } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// The activity feed's anti-corruption layer and its per-actor projection (SEC-30, PERF-B3m).
//
// activityRowsOf translates one recorded FOREIGN event into Social's activity rows, reading the
// serialised payload (Social's domain never imports other contexts' event classes). It decides who
// did what; it never decides who may see it. The viewer gates (started opt-in and mutual follow,
// profile unlock, canViewCopy, blocks, a start not yet begun) stay in social/getActivityFeed, which
// applies them at read time.
//
// Foreign events mapped (verified against the emitting domains):
//   CompletionRecorded (Solving)  -> "completion",  actor = payload.userId,  ref = completionId
//                                    (dated, non-bulk solves only)
//   CompletionStarted  (Solving)  -> "started",     actor = payload.userId,  ref = completionId,
//                                    with the solve's startDate
//   CopyAcquired       (Library)  -> "acquisition", actor = payload.ownerId, ref = copyId
//                                    or, with payload.batchId (one acquireCopies call),
//                                    "acquisitionBatch", ref = batchId, naming its copy
//   ExchangeCompleted  (Exchange) -> "exchange",    one row per party (from the exchange row),
//                                    ref = exchangeId, with partyIds = [initiator, recipient]
export const FEED_EVENT_NAMES = [
  "CompletionRecorded",
  "CompletionStarted",
  "CopyAcquired",
  "ExchangeCompleted",
] as const;

export type ActivityRow = {
  actorId: string;
  kind: ActivityKind;
  ref: string;
  occurredAt: number;
  copyIds?: string[];
  startDate?: number;
  partyIds?: Id<"users">[];
};

export const activityRowsOf = async (
  ctx: QueryCtx,
  event: Doc<"domainEvents">,
): Promise<ActivityRow[]> => {
  const p = event.payload as Record<string, unknown>;
  const occurredAt = event.occurredAt;
  switch (event.name) {
    case "CompletionRecorded":
      // A year-only or undated solve is a backfill, and so is anything logged in a batch: none of
      // them is recent activity, so they never reach followers (spec 2026-10-17 §3.2, D4). Older
      // payloads carry neither field and read as dated, single solves. A past-solves batch is
      // HIDDEN, not grouped like a batch of copy adds: every solve in it is a backfill, even one
      // with a picked day, so there is no "logged N solves" entry.
      if ((p.datePrecision ?? "day") !== "day" || p.bulk === true) return [];
      return [
        {
          actorId: p.userId as string,
          kind: "completion",
          ref: p.completionId as string,
          occurredAt,
        },
      ];
    case "CompletionStarted":
      // The payload is frozen at emission: a later startDate edit does not move the feed's
      // "not begun yet" gate (accepted, like the deletion residual).
      return [
        {
          actorId: p.userId as string,
          kind: "started",
          ref: p.completionId as string,
          occurredAt,
          ...(typeof p.startDate === "number" && { startDate: p.startDate }),
        },
      ];
    case "CopyAcquired": {
      // A batch add (acquireCopies) tags every event with one batch id; they fold into a single
      // "acquisitionBatch" entry instead of one entry per box.
      const copyId = p.copyId as string;
      const batchId = p.batchId;
      if (typeof batchId !== "string") {
        return [
          {
            actorId: p.ownerId as string,
            kind: "acquisition",
            ref: copyId,
            occurredAt,
          },
        ];
      }
      return [
        {
          actorId: p.ownerId as string,
          kind: "acquisitionBatch",
          ref: batchId,
          occurredAt,
          copyIds: [copyId],
        },
      ];
    }
    case "ExchangeCompleted": {
      // ExchangeCompleted carries no member; resolve both parties from the persisted exchange row
      // (mirrors Notifications' both-party treatment) and attribute the settlement to each.
      const ref = p.exchangeId as string;
      const row = await ctx.db
        .query("exchanges")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", ref))
        .unique();
      if (!row) return [];
      const partyIds = [row.initiatorId, row.recipientId];
      return partyIds.map((actorId) => ({
        actorId,
        kind: "exchange" as const,
        ref,
        occurredAt,
        partyIds,
      }));
    }
    default:
      return [];
  }
};

export type ProjectionCounts = { inserted: number; updated: number };

// Fold one event into `activityEntries`, one row per (actor, kind, ref). Idempotent, so the
// dispatcher may retry it and the backfill may replay events the dispatcher already projected: an
// existing row is left alone, except a batch row, which gains the copies it does not list yet and
// keeps its newest event time. Events are not projected in order (retries, the backfill), so the
// read side orders a batch's copies itself. Rows are written only for an active member: a payload
// the account purge scrubbed ("deleted-member") or a departed actor gets none, so an event
// dispatched after the purge cannot bring their activity back. `dryRun` counts without writing.
export const projectActivityEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ProjectionCounts> => {
  const counts: ProjectionCounts = { inserted: 0, updated: 0 };
  for (const row of await activityRowsOf(ctx, event)) {
    const actorId = ctx.db.normalizeId("users", row.actorId);
    if (actorId === null) continue;
    const actor = await ctx.db.get(actorId);
    if (!actor?.isActive) continue;
    const existing = await ctx.db
      .query("activityEntries")
      .withIndex("by_actor_kind_ref", (q) =>
        q.eq("actorId", actorId).eq("kind", row.kind).eq("ref", row.ref),
      )
      .first();
    if (existing === null) {
      counts.inserted++;
      if (!dryRun) {
        await ctx.db.insert("activityEntries", {
          actorId,
          kind: row.kind,
          ref: row.ref,
          occurredAt: row.occurredAt,
          ...(row.copyIds && { copyIds: row.copyIds }),
          ...(row.startDate !== undefined && { startDate: row.startDate }),
          ...(row.partyIds && { partyIds: row.partyIds }),
        });
      }
      continue;
    }
    if (row.kind !== "acquisitionBatch") continue;
    const listed = existing.copyIds ?? [];
    const added = (row.copyIds ?? []).filter((id) => !listed.includes(id));
    const occurredAt = Math.max(existing.occurredAt, row.occurredAt);
    if (added.length === 0 && occurredAt === existing.occurredAt) continue;
    counts.updated++;
    if (!dryRun) {
      await ctx.db.patch(existing._id, {
        copyIds: [...listed, ...added],
        occurredAt,
      });
    }
  }
  return counts;
};
