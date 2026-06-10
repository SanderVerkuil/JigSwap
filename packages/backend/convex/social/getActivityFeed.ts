import type { ActivityEntryView } from "@jigswap/contracts";
import {
  type ActivityEntry,
  type ActivityKind,
  buildActivityFeed,
  type MemberId,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// The activity-feed read: the acting member's own activity plus the activity of everyone they
// follow, newest-first. It reads the DURABLE `domainEvents` log and maps FOREIGN events into
// Social's anti-corruption ActivityEntry shape AT THIS SEAM (anti-corruption: Social's domain
// never imports other contexts' event classes — we translate from the serialised payload here),
// then folds them through the pure buildActivityFeed projection.
//
// Foreign events mapped (verified against the emitting domains):
//   CompletionRecorded (Solving)  -> "completion",  member = payload.userId,  ref = completionId
//   CopyAcquired       (Library)  -> "acquisition", member = payload.ownerId, ref = copyId
//   ExchangeCompleted  (Exchange) -> "exchange",    members = both parties (row),  ref = exchangeId
const FEED_EVENT_NAMES = [
  "CompletionRecorded",
  "CopyAcquired",
  "ExchangeCompleted",
] as const;

const DEFAULT_LIMIT = 50;

export const getActivityFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ActivityEntryView[]> => {
    const me = await requireMember(ctx);
    const meId = me as unknown as Id<"users">;

    // Audience = the acting member + everyone they follow.
    const followRows = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", meId))
      .collect();
    const audience = new Set<string>([meId as string]);
    for (const f of followRows) audience.add(f.followeeId as string);

    // Pull the activity-bearing events. Convex has no OR over `name`, so collect per-name.
    const eventBatches = await Promise.all(
      FEED_EVENT_NAMES.map((name) =>
        ctx.db
          .query("domainEvents")
          .filter((q) => q.eq(q.field("name"), name))
          .collect(),
      ),
    );

    const entries: ActivityEntry[] = [];
    for (const batch of eventBatches) {
      for (const event of batch) {
        const mapped = await toActivityEntries(ctx, event, audience);
        entries.push(...mapped);
      }
    }

    const feed = buildActivityFeed(entries, {
      limit: args.limit ?? DEFAULT_LIMIT,
    });
    return feed.map(toActivityEntryView);
  },
});

const asMember = (id: string): MemberId => toMemberId(id);

// Translate one recorded foreign event into zero-or-more Social ActivityEntries, keeping only those
// whose member is in the audience. The ACL lives entirely here; the domain stays foreign-free.
const toActivityEntries = async (
  ctx: QueryCtx,
  event: Doc<"domainEvents">,
  audience: Set<string>,
): Promise<ActivityEntry[]> => {
  const p = event.payload as Record<string, unknown>;
  const occurredAt = new Date(event.occurredAt);

  const make = (
    memberId: string,
    kind: ActivityKind,
    ref: string,
  ): ActivityEntry[] =>
    audience.has(memberId)
      ? [{ memberId: asMember(memberId), kind, occurredAt, ref }]
      : [];

  switch (event.name) {
    case "CompletionRecorded":
      return make(p.userId as string, "completion", p.completionId as string);
    case "CopyAcquired":
      return make(p.ownerId as string, "acquisition", p.copyId as string);
    case "ExchangeCompleted": {
      // ExchangeCompleted carries no member; resolve both parties from the persisted exchange row
      // (mirrors Notifications' both-party treatment) and attribute the settlement to each.
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      const ref = p.exchangeId as string;
      return [
        ...make(row.initiatorId as string, "exchange", ref),
        ...make(row.recipientId as string, "exchange", ref),
      ];
    }
    default:
      return [];
  }
};

// Resolve a persisted exchange from its ExchangeId aggregateId so we can attribute the parties.
const loadExchange = (
  ctx: QueryCtx,
  aggregateId: string,
): Promise<Doc<"exchanges"> | null> =>
  ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();

const toActivityEntryView = (entry: ActivityEntry): ActivityEntryView => ({
  memberId: entry.memberId as string,
  kind: entry.kind,
  occurredAt: entry.occurredAt.getTime(),
  ref: entry.ref,
});
