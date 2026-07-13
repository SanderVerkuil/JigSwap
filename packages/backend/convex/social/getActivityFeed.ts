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

// Time window + per-name cap so the feed reads a bounded slice of `domainEvents` (via the
// `by_name` index) instead of scanning the whole log. 90 days comfortably covers a feed page.
const FEED_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const PER_NAME_CAP = 500;

// KNOWN SCALE LIMITATION (finding #7, tracked as a follow-up):
//   This query pulls a GLOBAL newest-`PER_NAME_CAP`-per-event-name window (keyed on event name +
//   time, NOT on member) and only THEN filters down to the viewer's audience in memory. On a busy
//   platform the newest 500 events of a given name can all belong to members the viewer does not
//   follow, so a viewer following only a few people could see a stale/empty feed even when their
//   followees have recent activity that fell outside the global window. The 90-day window does not
//   help — the cap, not the window, is the binding constraint under load.
//
//   The correct fix is a per-actor read path, NOT a bigger cap (which only defers the problem and
//   inflates every read): either (a) add an `actorId` column to `domainEvents` populated at record
//   time with a `by_actor_and_time` index and query per audience member, or (b) maintain a
//   denormalized per-member activity table written by the event dispatcher. Both require changes
//   across the emitting domains (and a backfill), and ExchangeCompleted carries no member today
//   (parties are resolved from the exchange row), so this is deliberately left as a follow-up
//   rather than a risky partial. Raising PER_NAME_CAP is an accepted stopgap if needed.

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

    // Pull the activity-bearing events. Convex has no OR over `name`, so query per-name via the
    // `by_name` index, bounded to a recent window and capped (newest-first) to avoid a full scan.
    const since = Date.now() - FEED_WINDOW_MS;
    const eventBatches = await Promise.all(
      FEED_EVENT_NAMES.map((name) =>
        ctx.db
          .query("domainEvents")
          .withIndex("by_name", (q) =>
            q.eq("name", name).gte("occurredAt", since),
          )
          .order("desc")
          .take(PER_NAME_CAP),
      ),
    );

    const entries: ActivityEntry[] = [];
    for (const batch of eventBatches) {
      for (const event of batch) {
        const mapped = await toActivityEntries(ctx, event, audience);
        entries.push(...mapped);
      }
    }

    // One activity per (kind, ref): an ExchangeCompleted is attributed to BOTH parties, so a viewer
    // who is a party AND follows the counterparty would otherwise see the same exchange twice.
    // buildActivityFeed only sorts/slices, so dedupe here, keeping the first occurrence.
    const deduped = [
      ...new Map(entries.map((e) => [`${e.kind}:${e.ref}`, e])).values(),
    ];

    const feed = buildActivityFeed(deduped, {
      limit: args.limit ?? DEFAULT_LIMIT,
    });

    // Resolve each distinct actor's display name once (not per-entry) so a feed with repeat actors
    // doesn't re-query the same profile/user rows.
    const distinctActorIds = [
      ...new Set(feed.map((e) => e.memberId as string)),
    ];
    const actorNames = new Map(
      await Promise.all(
        distinctActorIds.map(
          async (id) => [id, await resolveActorName(ctx, id)] as const,
        ),
      ),
    );

    return feed.map((entry) =>
      toActivityEntryView(entry, actorNames.get(entry.memberId as string)!),
    );
  },
});

// Prefer the actor's Social profile display name, falling back to their account name (mirrors
// `toFollowEdgeView`'s counterparty-name resolution) so an actor without a profile still renders.
const resolveActorName = async (
  ctx: QueryCtx,
  memberId: string,
): Promise<string> => {
  const id = memberId as unknown as Id<"users">;
  const [profile, user] = await Promise.all([
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", id))
      .unique(),
    ctx.db.get(id),
  ]);
  return profile?.displayName ?? user?.name ?? "Member";
};

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

const toActivityEntryView = (
  entry: ActivityEntry,
  actorName: string,
): ActivityEntryView => ({
  memberId: entry.memberId as string,
  kind: entry.kind,
  occurredAt: entry.occurredAt.getTime(),
  ref: entry.ref,
  actorName,
});
