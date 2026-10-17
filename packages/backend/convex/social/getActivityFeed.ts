import type {
  ActivityBatchCoverView,
  ActivityEntryView,
} from "@jigswap/contracts";
import {
  buildActivityFeed,
  toMemberId,
  type ActivityEntry,
  type ActivityKind,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { areMutualFollowers, canSeeProfileContent } from "./privacy";

// The activity-feed read: the acting member's own activity plus the activity of everyone they
// follow, newest-first. It reads the DURABLE `domainEvents` log and maps FOREIGN events into
// Social's anti-corruption ActivityEntry shape AT THIS SEAM (anti-corruption: Social's domain
// never imports other contexts' event classes — we translate from the serialised payload here),
// then folds them through the pure buildActivityFeed projection.
//
// Foreign events mapped (verified against the emitting domains):
//   CompletionRecorded (Solving)  -> "completion",  member = payload.userId,  ref = completionId
//   CompletionStarted  (Solving)  -> "started",     member = payload.userId,  ref = completionId
//                                    (opt-in + mutual-followers-only, filtered below)
//   CopyAcquired       (Library)  -> "acquisition", member = payload.ownerId, ref = copyId
//                                    or, with payload.batchId (one acquireCopies call), ONE
//                                    "acquisitionBatch" per batch, ref = batchId (grouped below)
//   ExchangeCompleted  (Exchange) -> "exchange",    members = both parties (row),  ref = exchangeId
const FEED_EVENT_NAMES = [
  "CompletionRecorded",
  "CompletionStarted",
  "CopyAcquired",
  "ExchangeCompleted",
] as const;

const DEFAULT_LIMIT = 50;

// How many covers a grouped batch entry shows.
const BATCH_COVER_COUNT = 4;

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

    // batchId -> the copy ids its CopyAcquired events name, collected while mapping.
    const batchCopyIds = new Map<string, string[]>();
    const entries: ActivityEntry[] = [];
    for (const batch of eventBatches) {
      for (const event of batch) {
        const mapped = await toActivityEntries(
          ctx,
          event,
          audience,
          batchCopyIds,
        );
        entries.push(...mapped);
      }
    }

    // One activity per (kind, ref): an ExchangeCompleted is attributed to BOTH parties, so a viewer
    // who is a party AND follows the counterparty would otherwise see the same exchange twice, and
    // a batch add maps one entry per CopyAcquired event. buildActivityFeed only sorts/slices, so
    // dedupe here, keeping the first occurrence: events are read newest-first, so a grouped batch
    // keeps its newest event's time (the batch time).
    const deduped = [
      ...new Map(entries.map((e) => [`${e.kind}:${e.ref}`, e])).values(),
    ];

    // "started" is OPT-IN and FRIENDS-ONLY (spec §4): the actor must have shareInProgress === true
    // (tri-state; absent = off) AND be a mutual follower of the viewer. The viewer's own starts are
    // exempt. Checked once per distinct actor — bounded by the audience-filtered entries, not the
    // raw event batch — and BEFORE buildActivityFeed's limit slice so pages are never short.
    const startedActorIds = [
      ...new Set(
        deduped
          .filter(
            (e) =>
              e.kind === "started" &&
              (e.memberId as string) !== (meId as string),
          )
          .map((e) => e.memberId as string),
      ),
    ];
    const startedActorAllowed = new Map(
      await Promise.all(
        startedActorIds.map(async (id) => {
          const actorId = id as unknown as Id<"users">;
          const prefs = await ctx.db
            .query("solvingPreferences")
            .withIndex("by_member", (q) => q.eq("memberId", actorId))
            .unique();
          if (prefs?.shareInProgress !== true) return [id, false] as const;
          return [id, await areMutualFollowers(ctx, meId, actorId)] as const;
        }),
      ),
    );
    const visible = deduped.filter(
      (e) =>
        e.kind !== "started" ||
        (e.memberId as string) === (meId as string) ||
        startedActorAllowed.get(e.memberId as string) === true,
    );

    // A grouped batch shows only the copies THIS viewer may see; one with none is dropped. Resolved
    // BEFORE the limit slice (like "started") so pages are never short.
    const batchCopies = await visibleBatchCopies(
      ctx,
      meId,
      visible.filter((e) => e.kind === "acquisitionBatch"),
      batchCopyIds,
    );
    const shown = visible.filter(
      (e) =>
        e.kind !== "acquisitionBatch" ||
        (batchCopies.get(e.ref)?.length ?? 0) > 0,
    );

    const feed = buildActivityFeed(shown, {
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

    return Promise.all(
      feed.map(async (entry) =>
        toActivityEntryView(
          entry,
          actorNames.get(entry.memberId as string),
          entry.kind === "acquisitionBatch"
            ? await toBatchView(ctx, batchCopies.get(entry.ref) ?? [])
            : undefined,
        ),
      ),
    );
  },
});

// The copies of each grouped batch that `viewerId` may see, in pick order. Same two gates as the
// member's profile puzzles (listProfileCopies), which the entry links to: the profile unlock rule
// (self, public profile, or mutual follower), then the per-copy canViewCopy gate. A copy that was
// deleted or has since changed hands no longer counts toward the actor's batch.
const visibleBatchCopies = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  batchEntries: ActivityEntry[],
  batchCopyIds: Map<string, string[]>,
): Promise<Map<string, Doc<"ownedPuzzles">[]>> => {
  const result = new Map<string, Doc<"ownedPuzzles">[]>();
  // Sequential: the context's ownerVisibility memo isn't safe to share across a Promise.all.
  let context: CopyViewContext | null = null;
  for (const entry of batchEntries) {
    const actorId = entry.memberId as unknown as Id<"users">;
    const isSelf = actorId === viewerId;
    if (!isSelf && !(await canSeeProfileContent(ctx, viewerId, actorId))) {
      result.set(entry.ref, []);
      continue;
    }
    // Collected newest-first from the event read; reverse for the order they were picked in.
    const copyIds = [...(batchCopyIds.get(entry.ref) ?? [])].reverse();
    const copies: Doc<"ownedPuzzles">[] = [];
    for (const copyId of copyIds) {
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique();
      if (!copy || copy.ownerId !== actorId) continue;
      if (!isSelf) {
        context ??= await buildCopyViewContext(ctx, viewerId);
        if (!(await canViewCopyWithContext(ctx, copy, context))) continue;
      }
      copies.push(copy);
    }
    result.set(entry.ref, copies);
  }
  return result;
};

// The grouped entry's payload: the visible count and the first few covers. Covers are resolved
// only for the entries that made the page.
const toBatchView = async (
  ctx: QueryCtx,
  copies: Doc<"ownedPuzzles">[],
): Promise<ActivityEntryView["batch"]> => ({
  count: copies.length,
  covers: await Promise.all(
    copies
      .slice(0, BATCH_COVER_COUNT)
      .map(async (copy): Promise<ActivityBatchCoverView> => {
        const puzzle = await ctx.db.get(copy.puzzleId);
        return {
          copyId: copy.aggregateId as string,
          title: puzzle?.title ?? copy.snapshot?.title ?? "",
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
        };
      }),
  ),
});

// Prefer the actor's Social profile display name, falling back to their account name (mirrors
// `toFollowEdgeView`'s counterparty-name resolution) so an actor without a profile still renders.
const resolveActorName = async (
  ctx: QueryCtx,
  memberId: string,
): Promise<string | undefined> => {
  const id = memberId as unknown as Id<"users">;
  const [profile, user] = await Promise.all([
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", id))
      .unique(),
    ctx.db.get(id),
  ]);
  return memberDisplayNameOf(user, profile);
};

const asMember = (id: string): MemberId => toMemberId(id);

// Translate one recorded foreign event into zero-or-more Social ActivityEntries, keeping only those
// whose member is in the audience. The ACL lives entirely here; the domain stays foreign-free.
const toActivityEntries = async (
  ctx: QueryCtx,
  event: Doc<"domainEvents">,
  audience: Set<string>,
  batchCopyIds: Map<string, string[]>,
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
    case "CompletionStarted": {
      // A future-dated start hasn't begun; don't announce it (spec §2).
      // Payload is frozen at emission; a later startDate edit does not move this gate (accepted,
      // like the deletion residual).
      const startDate = p.startDate as number | undefined;
      if (startDate !== undefined && startDate > Date.now()) return [];
      return make(p.userId as string, "started", p.completionId as string);
    }
    case "CopyAcquired": {
      // A batch add (acquireCopies) tags every event with one batch id; they fold into a single
      // "acquisitionBatch" entry (deduped by ref = batchId) instead of one entry per box.
      const batchId = p.batchId;
      if (typeof batchId !== "string") {
        return make(p.ownerId as string, "acquisition", p.copyId as string);
      }
      const grouped = make(p.ownerId as string, "acquisitionBatch", batchId);
      if (grouped.length > 0) {
        batchCopyIds.set(batchId, [
          ...(batchCopyIds.get(batchId) ?? []),
          p.copyId as string,
        ]);
      }
      return grouped;
    }
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
  actorName: string | undefined,
  batch: ActivityEntryView["batch"],
): ActivityEntryView => ({
  memberId: entry.memberId as string,
  kind: entry.kind,
  occurredAt: entry.occurredAt.getTime(),
  ref: entry.ref,
  actorName,
  ...(batch ? { batch } : {}),
});
