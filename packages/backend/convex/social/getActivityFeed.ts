import type {
  ActivityBatchCoverView,
  ActivityEntryView,
  ActivityTargetView,
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
//                                    (dated, non-bulk solves only)
//   CompletionStarted  (Solving)  -> "started",     member = payload.userId,  ref = completionId
//                                    (opt-in + mutual-followers-only, filtered below)
//   CopyAcquired       (Library)  -> "acquisition", member = payload.ownerId, ref = copyId
//                                    or, with payload.batchId (one acquireCopies call), ONE
//                                    "acquisitionBatch" per batch, ref = batchId (grouped below);
//                                    both are gated per copy on what the viewer may see
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

    // Acquisition entry ref (copyId, or batchId for a grouped batch) -> the copy ids its
    // CopyAcquired events name, collected while mapping.
    const entryCopyIds = new Map<string, string[]>();
    const entries: ActivityEntry[] = [];
    for (const batch of eventBatches) {
      for (const event of batch) {
        const mapped = await toActivityEntries(
          ctx,
          event,
          audience,
          entryCopyIds,
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

    // An acquisition (single or grouped batch) shows only the copies THIS viewer may see; one with
    // none is dropped. Resolved BEFORE the limit slice (like "started") so pages are never short.
    const isAcquisition = (e: ActivityEntry) =>
      e.kind === "acquisition" || e.kind === "acquisitionBatch";
    const acquiredCopies = await visibleAcquiredCopies(
      ctx,
      meId,
      visible.filter(isAcquisition),
      entryCopyIds,
    );
    const shown = visible.filter(
      (e) => !isAcquisition(e) || (acquiredCopies.get(e.ref)?.length ?? 0) > 0,
    );

    const feed = buildActivityFeed(shown, {
      limit: args.limit ?? DEFAULT_LIMIT,
    });

    // Resolve each distinct actor's display name once (not per-entry) so a feed with repeat actors
    // doesn't re-query the same profile/user rows.
    const distinctActorIds = [
      ...new Set(feed.map((e) => e.memberId as string)),
    ];
    const actors = new Map(
      await Promise.all(
        distinctActorIds.map(
          async (id) => [id, await resolveActor(ctx, id)] as const,
        ),
      ),
    );

    // Each entry's link target, decided only for the entries that made the page. Sequential: the
    // lazily built copy-view context and its memo aren't Promise.all-safe.
    const targets: (ActivityTargetView | undefined)[] = [];
    const targetContext: { copyView: CopyViewContext | null } = {
      copyView: null,
    };
    for (const entry of feed) {
      targets.push(
        await resolveTarget(
          ctx,
          meId,
          entry,
          acquiredCopies,
          actors.get(entry.memberId as string)?.linkable === true,
          targetContext,
        ),
      );
    }

    return Promise.all(
      feed.map(async (entry, index) =>
        toActivityEntryView(
          entry,
          actors.get(entry.memberId as string),
          entry.kind === "acquisitionBatch"
            ? await toBatchView(ctx, acquiredCopies.get(entry.ref) ?? [])
            : undefined,
          targets[index],
        ),
      ),
    );
  },
});

// The copies of each acquisition entry (a single add or a grouped batch) that `viewerId` may see,
// in pick order. Same two gates as the member's profile puzzles (listProfileCopies), which the entry
// links to: the profile unlock rule (self, public profile, or mutual follower), then the per-copy
// canViewCopy gate. A copy that was deleted or has since changed hands no longer counts toward the
// actor's entry.
const visibleAcquiredCopies = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  acquisitionEntries: ActivityEntry[],
  entryCopyIds: Map<string, string[]>,
): Promise<Map<string, Doc<"ownedPuzzles">[]>> => {
  const result = new Map<string, Doc<"ownedPuzzles">[]>();
  // Sequential: the context's ownerVisibility memo isn't safe to share across a Promise.all.
  let context: CopyViewContext | null = null;
  for (const entry of acquisitionEntries) {
    const actorId = entry.memberId as unknown as Id<"users">;
    const isSelf = actorId === viewerId;
    if (!isSelf && !(await canSeeProfileContent(ctx, viewerId, actorId))) {
      result.set(entry.ref, []);
      continue;
    }
    // Collected newest-first from the event read; reverse for the order they were picked in.
    const copyIds = [...(entryCopyIds.get(entry.ref) ?? [])].reverse();
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

// Where an entry links, decided with the SAME gate the target page's own read applies, so the
// client never guesses an id or a visibility:
//   acquisition      -> the copy page. The entry's copy already passed canViewCopy (and the profile
//                       unlock rule) in visibleAcquiredCopies, which is getCopyInstanceView's gate.
//   acquisitionBatch -> the actor's profile puzzles. The batch already passed the profile unlock rule
//                       (listProfileCopies' gate); the profile page itself needs an active member.
//   completion/started -> the solve's copy when the viewer may reach it (canViewCopy), else the
//                       puzzle definition, exactly like the profile's solves list
//                       (listProfileCompletions), behind its profile unlock rule.
//   exchange         -> the viewer's trades page, only when the viewer is a party; a follower who is
//                       not a party gets no target (the actor link still goes to the profile).
const resolveTarget = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  entry: ActivityEntry,
  acquiredCopies: Map<string, Doc<"ownedPuzzles">[]>,
  actorLinkable: boolean,
  context: { copyView: CopyViewContext | null },
): Promise<ActivityTargetView | undefined> => {
  const actorId = entry.memberId as unknown as Id<"users">;
  switch (entry.kind) {
    case "acquisition": {
      const copy = acquiredCopies.get(entry.ref)?.[0];
      if (!copy) return undefined;
      return {
        kind: copy.ownerId === viewerId ? "myCopy" : "copy",
        id: copy._id as string,
      };
    }
    case "acquisitionBatch":
      return actorLinkable
        ? { kind: "memberPuzzles", handle: entry.memberId as string }
        : undefined;
    case "completion":
    case "started": {
      if (!(await canSeeProfileContent(ctx, viewerId, actorId))) {
        return undefined;
      }
      const completion = await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", entry.ref))
        .unique();
      if (!completion || completion.userId !== actorId) return undefined;
      const copy = completion.ownedPuzzleId
        ? await ctx.db.get(completion.ownedPuzzleId)
        : null;
      let reachable = false;
      if (copy) {
        if (copy.ownerId === viewerId || copy.heldBy === viewerId) {
          reachable = true;
        } else {
          context.copyView ??= await buildCopyViewContext(ctx, viewerId);
          reachable = await canViewCopyWithContext(ctx, copy, context.copyView);
        }
      }
      if (copy && reachable) {
        return {
          kind: copy.ownerId === viewerId ? "myCopy" : "copy",
          id: copy._id as string,
        };
      }
      const puzzleId =
        completion.puzzleId ?? (copy && reachable ? copy.puzzleId : undefined);
      const puzzle = puzzleId ? await ctx.db.get(puzzleId) : null;
      return puzzle
        ? { kind: "definition", id: puzzle._id as string }
        : undefined;
    }
    case "exchange": {
      const row = await loadExchange(ctx, entry.ref);
      const isParty =
        row !== null &&
        (row.initiatorId === viewerId || row.recipientId === viewerId);
      return isParty ? { kind: "trades" } : undefined;
    }
    default:
      return undefined;
  }
};

// Prefer the actor's Social profile display name, falling back to their account name (mirrors
// `toFollowEdgeView`'s counterparty-name resolution) so an actor without a profile still renders.
// `linkable` mirrors resolveMemberByHandle: the profile page only resolves an active member.
const resolveActor = async (
  ctx: QueryCtx,
  memberId: string,
): Promise<{ name: string | undefined; linkable: boolean }> => {
  const id = memberId as unknown as Id<"users">;
  const [profile, user] = await Promise.all([
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", id))
      .unique(),
    ctx.db.get(id),
  ]);
  return {
    name: memberDisplayNameOf(user, profile),
    linkable: user?.isActive === true,
  };
};

const asMember = (id: string): MemberId => toMemberId(id);

// Translate one recorded foreign event into zero-or-more Social ActivityEntries, keeping only those
// whose member is in the audience. The ACL lives entirely here; the domain stays foreign-free.
const toActivityEntries = async (
  ctx: QueryCtx,
  event: Doc<"domainEvents">,
  audience: Set<string>,
  entryCopyIds: Map<string, string[]>,
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
      // A year-only or undated solve is a backfill, and so is anything logged in a batch: none of
      // them is recent activity, so they never reach followers (spec 2026-10-17 §3.2, D4). Older
      // payloads carry neither field and read as dated, single solves. A past-solves batch is
      // HIDDEN, not grouped like a batch of copy adds: every solve in it is a backfill, even one
      // with a picked day, so there is no "logged N solves" entry.
      if ((p.datePrecision ?? "day") !== "day" || p.bulk === true) return [];
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
      // Either way the entry's copies are recorded so the caller can gate it per copy.
      const copyId = p.copyId as string;
      const batchId = p.batchId;
      if (typeof batchId !== "string") {
        const single = make(p.ownerId as string, "acquisition", copyId);
        if (single.length > 0) entryCopyIds.set(copyId, [copyId]);
        return single;
      }
      const grouped = make(p.ownerId as string, "acquisitionBatch", batchId);
      if (grouped.length > 0) {
        entryCopyIds.set(batchId, [
          ...(entryCopyIds.get(batchId) ?? []),
          copyId,
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
  actor: { name: string | undefined; linkable: boolean } | undefined,
  batch: ActivityEntryView["batch"],
  target: ActivityTargetView | undefined,
): ActivityEntryView => ({
  memberId: entry.memberId as string,
  kind: entry.kind,
  occurredAt: entry.occurredAt.getTime(),
  ref: entry.ref,
  actorName: actor?.name,
  ...(batch ? { batch } : {}),
  ...(actor?.linkable ? { actor: { handle: entry.memberId as string } } : {}),
  ...(target ? { target } : {}),
});
