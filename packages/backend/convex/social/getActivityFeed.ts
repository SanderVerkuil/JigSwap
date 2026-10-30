import type {
  ActivityBatchCoverView,
  ActivityEntryView,
  ActivityTargetView,
} from "@jigswap/contracts";
import {
  buildActivityFeed,
  toMemberId,
  type ActivityEntry,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { canViewDefinition } from "../catalog/definitionVisibility";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { clampLimit } from "../lib/pageSize";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { toCopyPuzzleView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import {
  activityRowsOf,
  FEED_EVENT_NAMES,
  FEED_WINDOW_MS,
} from "./activityEntries";
import { blockedEitherWaySet } from "./blocks";
import { areMutualFollowers, canSeeProfileContent } from "./privacy";

// The activity-feed read: the acting member's own activity plus the activity of everyone they
// follow, newest-first. It reads the DURABLE `domainEvents` log, maps FOREIGN events into Social's
// anti-corruption ActivityEntry shape through social/activityEntries.activityRowsOf (the one
// event-to-entry mapping, shared with the activity read model), keeps those of the audience, then
// folds them through the pure buildActivityFeed projection. "started" entries are opt-in and
// mutual-followers-only, and acquisitions (single or a grouped batch) are gated per copy on what
// the viewer may see; both filtered below.
// Whatever the kind, an entry of another member shows only while the viewer may see that member's
// profile content (canSeeProfileContent, SEC-43); the per-kind rules above only narrow that.

// A page holds 1 to MAX_LIMIT entries whatever the client asks for.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

// How many covers a grouped batch entry shows.
const BATCH_COVER_COUNT = 4;

// Time window (FEED_WINDOW_MS, 90 days) + per-name cap so the feed reads a bounded slice of
// `domainEvents` (via the `by_name` index) instead of scanning the whole log.
// Event retention (events/retention) keeps dispatched events longer than this window.
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
    // Blocked actors drop out (spec 2.6), e.g. the counterparty of a shared exchange.
    for (const id of await blockedEitherWaySet(ctx, meId)) {
      audience.delete(id as string);
    }

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
    const now = Date.now();
    for (const batch of eventBatches) {
      for (const event of batch) {
        for (const row of await activityRowsOf(ctx, event)) {
          if (!audience.has(row.actorId)) continue;
          // A future-dated start hasn't begun; don't announce it (spec §2).
          if (row.startDate !== undefined && row.startDate > now) continue;
          entries.push({
            memberId: asMember(row.actorId),
            kind: row.kind,
            occurredAt: new Date(row.occurredAt),
            ref: row.ref,
          });
          if (row.kind === "acquisition") entryCopyIds.set(row.ref, [row.ref]);
          if (row.kind === "acquisitionBatch") {
            entryCopyIds.set(row.ref, [
              ...(entryCopyIds.get(row.ref) ?? []),
              ...(row.copyIds ?? []),
            ]);
          }
        }
      }
    }

    // Every entry of ANOTHER member needs the profile-content unlock (SEC-43): the viewer sees an
    // actor's completions, exchanges, adds and starts only while canSeeProfileContent holds (a
    // public profile or mutual followers; never across a block), so following a private member
    // one way unlocks nothing. The kind-specific rules below (opt-in starts, per-copy acquisitions)
    // only narrow this further. Checked once per distinct actor, and BEFORE the (kind, ref) dedupe:
    // an exchange is attributed to both parties, and the viewer's own party entry must survive
    // when the counterparty's is dropped.
    const actorUnlocked = new Map<string, boolean>();
    const permitted: ActivityEntry[] = [];
    for (const e of entries) {
      const actor = e.memberId as string;
      if (actor === (meId as string)) {
        permitted.push(e);
        continue;
      }
      let unlocked = actorUnlocked.get(actor);
      if (unlocked === undefined) {
        unlocked = await canSeeProfileContent(
          ctx,
          meId,
          actor as unknown as Id<"users">,
        );
        actorUnlocked.set(actor, unlocked);
      }
      if (unlocked) permitted.push(e);
    }

    // One activity per (kind, ref): an ExchangeCompleted is attributed to BOTH parties, so a viewer
    // who is a party AND follows the counterparty would otherwise see the same exchange twice, and
    // a batch add maps one entry per CopyAcquired event. buildActivityFeed only sorts/slices, so
    // dedupe here, keeping the first occurrence: events are read newest-first, so a grouped batch
    // keeps its newest event's time (the batch time).
    const deduped = [
      ...new Map(permitted.map((e) => [`${e.kind}:${e.ref}`, e])).values(),
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
      limit: clampLimit(args.limit, {
        fallback: DEFAULT_LIMIT,
        max: MAX_LIMIT,
      }),
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
            ? await toBatchView(ctx, meId, acquiredCopies.get(entry.ref) ?? [])
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
// only for the entries that made the page. A cover's title follows the copy views' rule
// (toCopyPuzzleView): the definition's current title when it is approved, or when the viewer owns
// the copy and it is disabled or their own submission; otherwise the copy's snapshot title, never a
// non-approved definition's live one.
const toBatchView = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copies: Doc<"ownedPuzzles">[],
): Promise<ActivityEntryView["batch"]> => ({
  count: copies.length,
  covers: await Promise.all(
    copies
      .slice(0, BATCH_COVER_COUNT)
      .map(async (copy): Promise<ActivityBatchCoverView> => {
        const puzzle = await ctx.db.get(copy.puzzleId);
        const shown = toCopyPuzzleView(copy, puzzle, {
          includeOwnerOnly: copy.ownerId === viewerId,
        });
        return {
          copyId: copy.aggregateId as string,
          title: shown?.title ?? copy.snapshot?.title ?? "",
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
//                       puzzle definition when the viewer may open it (canViewDefinition, the
//                       definition page's gate), exactly like the profile's solves list
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
      return puzzle && (await canViewDefinition(ctx, puzzle, viewerId))
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
// A departed actor (users row gone or deactivated) is the ghost: no name, even while their profile
// row still waits for the account purge, and no link.
const resolveActor = async (
  ctx: QueryCtx,
  memberId: string,
): Promise<{
  name: string | undefined;
  linkable: boolean;
  departed: boolean;
}> => {
  const id = memberId as unknown as Id<"users">;
  const user = await ctx.db.get(id);
  if (!user || !user.isActive) {
    return { name: undefined, linkable: false, departed: true };
  }
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_member", (q) => q.eq("memberId", id))
    .unique();
  return {
    name: memberDisplayNameOf(user, profile),
    linkable: true,
    departed: false,
  };
};

const asMember = (id: string): MemberId => toMemberId(id);

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
  actor:
    | { name: string | undefined; linkable: boolean; departed: boolean }
    | undefined,
  batch: ActivityEntryView["batch"],
  target: ActivityTargetView | undefined,
): ActivityEntryView => ({
  memberId: entry.memberId as string,
  kind: entry.kind,
  occurredAt: entry.occurredAt.getTime(),
  ref: entry.ref,
  actorName: actor?.name,
  ...(actor?.departed ? { actorDeparted: true as const } : {}),
  ...(batch ? { batch } : {}),
  ...(actor?.linkable ? { actor: { handle: entry.memberId as string } } : {}),
  ...(target ? { target } : {}),
});
