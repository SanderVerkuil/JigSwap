import type {
  ActivityBatchCoverView,
  ActivityEntryView,
  ActivitySubjectView,
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
import { boxArtThumbUrl } from "../lib/imageModeration/boxArtUrl";
import { clampLimit } from "../lib/pageSize";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { toCopyPuzzleView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import {
  ACTIVITY_READ_MODEL,
  activityRowsOf,
  FEED_EVENT_NAMES,
  FEED_WINDOW_MS,
  type ActivityRow,
} from "./activityEntries";
import { blockedEitherWaySet } from "./blocks";
import { areMutualFollowers, canSeeProfileContent } from "./privacy";

// The activity-feed read: the acting member's own activity plus the activity of everyone they
// follow, newest-first, folded through the pure buildActivityFeed projection. Activity comes from
// one of two sources, mapped by the same anti-corruption layer (social/activityEntries):
//
//   the read model (once social/backfillActivityEntries has finished: its readModelStatus row
//     exists) — each audience member's own `activityEntries` range (by_actor_time), merged
//     newest-first. One member's activity can never crowd out another's (SEC-30), and a new row
//     only touches the feeds of its actor's followers, never every feed (PERF-B3m). The read is
//     bounded: it stops once `limit` entries pass the gates, after FEED_READ_BUDGET rows, and
//     takes at most PER_ACTOR_READ_CAP rows of any one member, so a followee's hidden entries
//     (unshared starts, copies the viewer can't see) use only their own share of it.
//   the event log (before that) — a GLOBAL newest-PER_NAME_CAP-per-event-name window of
//     `domainEvents`, filtered to the audience in memory. On a busy platform that window can be
//     all strangers' events; this path only covers deployments the backfill has not run on yet.
//
// Both paths run the SAME viewer gates (gateCandidates), before the limit slice so pages are never
// short: another member's entry only while the viewer may see their profile content
// (canSeeProfileContent, SEC-43); one entry per (kind, ref); a start only once it has begun, and
// from someone else only when they opted in and are a mutual follower; an acquisition only with the
// copies this viewer may see (canViewCopy). Blocked members are out of the audience, and it holds
// at most FEED_MAX_AUDIENCE members.

// A page holds 1 to MAX_LIMIT entries whatever the client asks for.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

// How many covers a grouped batch entry shows.
const BATCH_COVER_COUNT = 4;

// The event-log path: per event name, the newest PER_NAME_CAP events in FEED_WINDOW_MS (90 days),
// via the `by_name` index.
// Event retention (events/retention) keeps dispatched events longer than this window.
const PER_NAME_CAP = 500;

// The read-model path: rows read per feed, at most, and from any one member.
const FEED_READ_BUDGET = 500;
const PER_ACTOR_READ_CAP = 2 * MAX_LIMIT;

// The read-model path opens one index range per audience member, and Convex allows 4,096 per
// function, so a feed covers at most this many members: the viewer and the members they followed
// most recently. Nothing caps follows, so without it a member following thousands would break
// their own feed.
export const FEED_MAX_AUDIENCE = 1000;

// A feed entry plus what the read-time gates and the link target need.
type Candidate = {
  entry: ActivityEntry;
  // An acquisition's copies (ownedPuzzles.aggregateId): the copy itself, or a batch's copies.
  copyIds: string[];
  startDate?: number;
  partyIds?: Id<"users">[];
};

// What the gates remember across the chunks of one read.
type Gates = {
  viewerId: Id<"users">;
  audience: Set<string>;
  now: number;
  seen: Set<string>;
  startedAllowed: Map<string, boolean>;
  profileUnlocked: Map<string, boolean>;
  copyView: CopyViewContext | null;
  // Acquisition ref -> the copies the viewer may see, in pick order.
  acquiredCopies: Map<string, Doc<"ownedPuzzles">[]>;
};

export const getActivityFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ActivityEntryView[]> => {
    const me = await requireMember(ctx);
    const meId = me as unknown as Id<"users">;
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_LIMIT,
      max: MAX_LIMIT,
    });

    // Audience = the acting member + everyone they follow, up to FEED_MAX_AUDIENCE: past it, the
    // members they followed most recently. Blocked actors drop out (spec 2.6), e.g. the
    // counterparty of a shared exchange.
    const blocked = await blockedEitherWaySet(ctx, meId);
    const audience = new Set<string>([meId as string]);
    for await (const f of ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", meId))
      .order("desc")) {
      if (audience.size >= FEED_MAX_AUDIENCE) break;
      if (!blocked.has(f.followeeId)) audience.add(f.followeeId as string);
    }

    const since = Date.now() - FEED_WINDOW_MS;
    const gates: Gates = {
      viewerId: meId,
      audience,
      now: Date.now(),
      seen: new Set(),
      startedAllowed: new Map(),
      profileUnlocked: new Map(),
      copyView: null,
      acquiredCopies: new Map(),
    };
    const shown = (await readModelReady(ctx))
      ? await fromReadModel(ctx, audience, since, limit, gates)
      : await gateCandidates(
          ctx,
          await fromEventLog(ctx, audience, since),
          gates,
        );

    const feed = buildActivityFeed(
      shown.map((c) => c.entry),
      { limit },
    );
    const candidates = new Map(shown.map((c) => [keyOf(c.entry), c]));
    const acquiredCopies = gates.acquiredCopies;

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

    // Each entry's link target and subject, decided only for the entries that made the page.
    // Sequential: the lazily built copy-view context and its memo aren't Promise.all-safe.
    const links: EntryLink[] = [];
    const targetContext: { copyView: CopyViewContext | null } = {
      copyView: null,
    };
    for (const entry of feed) {
      links.push(
        await resolveTarget(
          ctx,
          meId,
          entry,
          candidates.get(keyOf(entry))?.partyIds,
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
          links[index],
        ),
      ),
    );
  },
});

const keyOf = (entry: ActivityEntry) => `${entry.kind}:${entry.ref}`;

const readModelReady = async (ctx: QueryCtx): Promise<boolean> =>
  (await ctx.db
    .query("readModelStatus")
    .withIndex("by_name", (q) => q.eq("name", ACTIVITY_READ_MODEL))
    .first()) !== null;

// One row as a feed candidate, under its actor until gateCandidates decides who it shows under.
const toCandidate = (row: ActivityRow): Candidate => ({
  entry: {
    memberId: asMember(row.actorId),
    kind: row.kind,
    occurredAt: new Date(row.occurredAt),
    ref: row.ref,
  },
  copyIds: row.kind === "acquisition" ? [row.ref] : [...(row.copyIds ?? [])],
  startDate: row.startDate,
  partyIds: row.partyIds,
});

// The read model: candidates newest-first, gated a chunk at a time, until `limit` pass the gates or
// the merged read stops (see newestActivityFirst).
const fromReadModel = async (
  ctx: QueryCtx,
  audience: Set<string>,
  since: number,
  limit: number,
  gates: Gates,
): Promise<Candidate[]> => {
  const shown: Candidate[] = [];
  let pending: Candidate[] = [];
  for await (const row of newestActivityFirst(ctx, [...audience], since)) {
    pending.push(toCandidate(row));
    if (shown.length + pending.length < limit) continue;
    shown.push(...(await gateCandidates(ctx, pending, gates)));
    pending = [];
    if (shown.length >= limit) return shown;
  }
  shown.push(...(await gateCandidates(ctx, pending, gates)));
  return shown;
};

// A k-way merge of the actors' by_actor_time ranges (occurredAt >= since), newest first. Yields at
// most FEED_READ_BUDGET rows in all and PER_ACTOR_READ_CAP of any one actor; it reads one row
// ahead per actor, so its reads grow with the audience (one per member followed), never with
// anyone else's activity.
async function* newestActivityFirst(
  ctx: QueryCtx,
  actorIds: string[],
  since: number,
): AsyncGenerator<Doc<"activityEntries">> {
  const sources = actorIds.map((actorId) => ({
    rows: ctx.db
      .query("activityEntries")
      .withIndex("by_actor_time", (q) =>
        q.eq("actorId", actorId as Id<"users">).gte("occurredAt", since),
      )
      .order("desc")
      [Symbol.asyncIterator](),
    head: null as Doc<"activityEntries"> | null,
    taken: 0,
  }));
  const advance = async (source: (typeof sources)[number]) => {
    const next =
      source.taken < PER_ACTOR_READ_CAP ? await source.rows.next() : null;
    source.head = next === null || next.done ? null : next.value;
  };
  await Promise.all(sources.map(advance));
  for (let read = 0; read < FEED_READ_BUDGET; read++) {
    let newest: (typeof sources)[number] | null = null;
    for (const source of sources) {
      if (
        source.head !== null &&
        (newest === null || source.head.occurredAt > newest.head!.occurredAt)
      ) {
        newest = source;
      }
    }
    if (newest === null) return;
    yield newest.head!;
    newest.taken++;
    await advance(newest);
  }
}

// The event log: the audience's activity in each event name's global window. A batch add maps one
// row per CopyAcquired event; they fold into the first, which collects every copy of the batch.
const fromEventLog = async (
  ctx: QueryCtx,
  audience: Set<string>,
  since: number,
): Promise<Candidate[]> => {
  // Convex has no OR over `name`, so query per-name via the `by_name` index, bounded to a recent
  // window and capped (newest-first) to avoid a full scan.
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
  const candidates = new Map<string, Candidate>();
  for (const batch of eventBatches) {
    for (const event of batch) {
      for (const row of await activityRowsOf(ctx, event)) {
        if (!audience.has(row.actorId)) continue;
        const known = candidates.get(`${row.kind}:${row.ref}`);
        if (known) known.copyIds.push(...(row.copyIds ?? []));
        else candidates.set(`${row.kind}:${row.ref}`, toCandidate(row));
      }
    }
  }
  return [...candidates.values()];
};

// Whether the viewer may see this actor's entries: their own, or another member's profile content
// (a public profile or mutual followers; never across a block). Checked once per distinct actor.
const actorUnlocked = async (
  ctx: QueryCtx,
  actor: string,
  gates: Gates,
): Promise<boolean> => {
  if (actor === (gates.viewerId as string)) return true;
  let unlocked = gates.profileUnlocked.get(actor);
  if (unlocked === undefined) {
    unlocked = await canSeeProfileContent(
      ctx,
      gates.viewerId,
      actor as unknown as Id<"users">,
    );
    gates.profileUnlocked.set(actor, unlocked);
  }
  return unlocked;
};

// The viewer gates, the same for both sources. Applied to each chunk of candidates in turn; `gates`
// carries what earlier chunks decided.
const gateCandidates = async (
  ctx: QueryCtx,
  candidates: Candidate[],
  gates: Gates,
): Promise<Candidate[]> => {
  const viewer = gates.viewerId as string;
  // Every entry of ANOTHER member needs the profile-content unlock (SEC-43): the viewer sees an
  // actor's completions, exchanges, adds and starts only while canSeeProfileContent holds, so
  // following a private member one way unlocks nothing. The kind-specific rules below only narrow
  // this further. An exchange is the activity of both parties: it shows under the first party of
  // the audience the viewer may see (the initiator when that is both), so it must be decided BEFORE
  // the (kind, ref) dedupe, and the viewer's own side survives when the counterparty's is hidden.
  const permitted: Candidate[] = [];
  for (const c of candidates) {
    const actors: string[] = c.partyIds?.filter((id) =>
      gates.audience.has(id),
    ) ?? [c.entry.memberId as string];
    for (const actor of actors) {
      if (!(await actorUnlocked(ctx, actor, gates))) continue;
      permitted.push({
        ...c,
        entry: { ...c.entry, memberId: asMember(actor) },
      });
      break;
    }
  }

  // One activity per (kind, ref): an exchange is attributed to BOTH parties, so a viewer who is a
  // party AND follows the counterparty would otherwise see it twice. Keep the first occurrence.
  // A future-dated start hasn't begun; don't announce it (spec §2).
  const fresh = permitted.filter((c) => {
    const key = keyOf(c.entry);
    if (gates.seen.has(key)) return false;
    gates.seen.add(key);
    return c.startDate === undefined || c.startDate <= gates.now;
  });

  // "started" is OPT-IN and FRIENDS-ONLY (spec §4): the actor must have shareInProgress === true
  // (tri-state; absent = off) AND be a mutual follower of the viewer. The viewer's own starts are
  // exempt. Checked once per distinct actor.
  const startedActorIds = [
    ...new Set(
      fresh
        .map((c) => c.entry)
        .filter(
          (e) =>
            e.kind === "started" &&
            (e.memberId as string) !== viewer &&
            !gates.startedAllowed.has(e.memberId as string),
        )
        .map((e) => e.memberId as string),
    ),
  ];
  for (const [id, allowed] of await Promise.all(
    startedActorIds.map(async (id) => {
      const actorId = id as unknown as Id<"users">;
      const prefs = await ctx.db
        .query("solvingPreferences")
        .withIndex("by_member", (q) => q.eq("memberId", actorId))
        .unique();
      if (prefs?.shareInProgress !== true) return [id, false] as const;
      return [
        id,
        await areMutualFollowers(ctx, gates.viewerId, actorId),
      ] as const;
    }),
  )) {
    gates.startedAllowed.set(id, allowed);
  }
  const visible = fresh.filter(
    (c) =>
      c.entry.kind !== "started" ||
      (c.entry.memberId as string) === viewer ||
      gates.startedAllowed.get(c.entry.memberId as string) === true,
  );

  // An acquisition (single or grouped batch) shows only the copies THIS viewer may see; one with
  // none is dropped.
  await visibleAcquiredCopies(ctx, visible.filter(isAcquisition), gates);
  return visible.filter(
    (c) =>
      !isAcquisition(c) ||
      (gates.acquiredCopies.get(c.entry.ref)?.length ?? 0) > 0,
  );
};

const isAcquisition = (c: Candidate) =>
  c.entry.kind === "acquisition" || c.entry.kind === "acquisitionBatch";

// The copies of each acquisition entry (a single add or a grouped batch) that the viewer may see,
// in pick order (a batch's copies are created in the order they were picked). Same two gates as the
// member's profile puzzles (listProfileCopies), which the entry links to: the profile unlock rule
// (self, public profile, or mutual follower; already passed in gateCandidates), then the per-copy
// canViewCopy gate. A copy that was deleted or has since changed hands no longer counts toward the
// actor's entry.
const visibleAcquiredCopies = async (
  ctx: QueryCtx,
  acquisitions: Candidate[],
  gates: Gates,
): Promise<void> => {
  // Sequential: the context's ownerVisibility memo isn't safe to share across a Promise.all.
  for (const { entry, copyIds } of acquisitions) {
    const actorId = entry.memberId as unknown as Id<"users">;
    const isSelf = actorId === gates.viewerId;
    const copies: Doc<"ownedPuzzles">[] = [];
    for (const copyId of copyIds) {
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique();
      if (!copy || copy.ownerId !== actorId) continue;
      if (!isSelf) {
        gates.copyView ??= await buildCopyViewContext(ctx, gates.viewerId);
        if (!(await canViewCopyWithContext(ctx, copy, gates.copyView)))
          continue;
      }
      copies.push(copy);
    }
    copies.sort((a, b) => a._creationTime - b._creationTime);
    gates.acquiredCopies.set(entry.ref, copies);
  }
};

// A copy's title for this viewer, by the copy views' rule (toCopyPuzzleView): the definition's
// current title when it is approved, or when the viewer owns the copy and it is disabled or their
// own submission; otherwise the copy's snapshot title, never a non-approved definition's live one.
const copyTitleFor = (
  copy: Doc<"ownedPuzzles">,
  puzzle: Doc<"puzzles"> | null,
  viewerId: Id<"users">,
): string | undefined =>
  toCopyPuzzleView(copy, puzzle, {
    includeOwnerOnly: copy.ownerId === viewerId,
  })?.title ?? copy.snapshot?.title;

// The grouped entry's payload: the visible count and the first few covers. Covers are resolved
// only for the entries that made the page.
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
        return {
          copyId: copy.aggregateId as string,
          title: copyTitleFor(copy, puzzle, viewerId) ?? "",
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
        };
      }),
  ),
});

// What an entry links to and which puzzle it names. The subject is decided behind the SAME gate as
// the target (it never names a copy the viewer couldn't open), so it is resolved here, together.
type EntryLink = { target?: ActivityTargetView; subject?: ActivitySubjectView };

// No title, no subject: the row keeps its untitled sentence rather than naming "".
const subjectOf = (
  title: string | undefined,
  coverUrl: string | null,
): ActivitySubjectView | undefined => (title ? { title, coverUrl } : undefined);

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
// The subject mirrors the page the row stands in for:
//   acquisition      -> the gated copy's title and cover, as the batch covers (toBatchView).
//   completion/started -> the solve's snapshot title (else the puzzle's, when the viewer may open
//                       that definition), with the copy's cover only when the viewer may reach the
//                       copy, else the box art, like listProfileCompletions' row; nothing when the
//                       profile is locked.
//   acquisitionBatch / exchange -> none (a batch names its puzzles in its covers).
// An entry's `title` is that subject's title when the entry also links: no target, no title.
const resolveTarget = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  entry: ActivityEntry,
  partyIds: Id<"users">[] | undefined,
  acquiredCopies: Map<string, Doc<"ownedPuzzles">[]>,
  actorLinkable: boolean,
  context: { copyView: CopyViewContext | null },
): Promise<EntryLink> => {
  const actorId = entry.memberId as unknown as Id<"users">;
  switch (entry.kind) {
    case "acquisition": {
      const copy = acquiredCopies.get(entry.ref)?.[0];
      if (!copy) return {};
      const puzzle = await ctx.db.get(copy.puzzleId);
      return {
        target: {
          kind: copy.ownerId === viewerId ? "myCopy" : "copy",
          id: copy._id as string,
        },
        subject: subjectOf(
          copyTitleFor(copy, puzzle, viewerId),
          await resolveCopyCoverUrl(ctx, copy, puzzle),
        ),
      };
    }
    case "acquisitionBatch":
      return actorLinkable
        ? {
            target: { kind: "memberPuzzles", handle: entry.memberId as string },
          }
        : {};
    case "completion":
    case "started": {
      if (!(await canSeeProfileContent(ctx, viewerId, actorId))) {
        return {};
      }
      const completion = await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", entry.ref))
        .unique();
      if (!completion || completion.userId !== actorId) return {};
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
      const puzzleId =
        completion.puzzleId ?? (copy && reachable ? copy.puzzleId : undefined);
      const puzzle = puzzleId ? await ctx.db.get(puzzleId) : null;
      // The definition page's own gate decides the link to that page AND whether the row may quote
      // the definition's live title, so a non-approved title never reaches a viewer it would refuse.
      const definitionVisible =
        puzzle !== null && (await canViewDefinition(ctx, puzzle, viewerId));
      const subject = subjectOf(
        completion.copySnapshot?.title ??
          (definitionVisible ? puzzle.title : undefined),
        copy && reachable
          ? await resolveCopyCoverUrl(ctx, copy, puzzle)
          : await boxArtThumbUrl(ctx, puzzle?.image),
      );
      if (copy && reachable) {
        return {
          target: {
            kind: copy.ownerId === viewerId ? "myCopy" : "copy",
            id: copy._id as string,
          },
          subject,
        };
      }
      return {
        target: definitionVisible
          ? { kind: "definition", id: puzzle._id as string }
          : undefined,
        subject,
      };
    }
    case "exchange":
      return partyIds?.includes(viewerId) ? { target: { kind: "trades" } } : {};
    default:
      return {};
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

const toActivityEntryView = (
  entry: ActivityEntry,
  actor:
    | { name: string | undefined; linkable: boolean; departed: boolean }
    | undefined,
  batch: ActivityEntryView["batch"],
  { target, subject }: EntryLink,
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
  ...(subject ? { subject } : {}),
  ...(target && subject ? { title: subject.title } : {}),
});
