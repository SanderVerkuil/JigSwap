import type {
  InboxThreadContextCopy,
  InboxThreadSubjectView,
  InboxThreadView,
  ProjectedMember,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import {
  projectTradeParty,
  tradePartyMemberView,
} from "../exchange/tradeParty";
import { requireMember } from "../identity/requireMember";
import { blockStateBetween } from "../social/blocks";
import { anonymousMemberOf, projectMemberIdentity } from "../social/privacy";
import { toLastMessage } from "./adapters/threadMapper";
import { viewableContextCopies } from "./copyCard";
import {
  circleDecorations,
  circleRowOf,
  inboxListable,
  participantUnreadCountOf,
  threadRowByAggregateId,
  toLastMessageView,
  visibleLastMessage,
} from "./readModelHelpers";
import { threadMemberProjector } from "./threadMemberProjection";

// Context-copy bounds. Message references are read through by_thread_copy_sent, so plain messages
// are never scanned for them. That index groups rows per copy (copyId, then sentAt), so each
// distinct copy costs one skip-scan probe: two single-row index reads (the next copyId, then that
// copy's newest reference). Per thread at most CONTEXT_COPY_PROBES distinct copies are probed;
// per inbox read at most CONTEXT_PROBE_BUDGET in total, spent on threads in newest-activity order.
// At most CONTEXT_COPY_CAP viewable copies are returned per thread.
const CONTEXT_COPY_CAP = 10;
const CONTEXT_COPY_PROBES = 50;
const CONTEXT_PROBE_BUDGET = 1000;

// Below every Id string, above `undefined`: `gt` on it skips rows without a copyId.
const LOWEST_COPY_ID = "" as Id<"ownedPuzzles">;

type ContextCopyResolver = ReturnType<typeof viewableContextCopies>;

// How many other members a circle row's avatar stack shows.
const CIRCLE_MEMBER_PREVIEW = 3;

type LastMessageSummary = NonNullable<Doc<"threads">["lastMessage"]>;

// A circle thread's subject: the circle's name and member count, and up to three other members
// for the avatar stack: the visible last message's author first, then other current
// participants. All through projectThreadMember (current co-members are named by the circle
// rule). Null once the circle is gone (its thread is being purged).
const circleSubjectOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
  last: LastMessageSummary | null,
): Promise<InboxThreadSubjectView | null> => {
  const circle =
    thread.circleId === undefined
      ? null
      : await circleRowOf(ctx, thread.circleId);
  if (!circle || thread.circleId === undefined) return null;
  const project = threadMemberProjector(ctx, me, thread);
  const previewIds: Id<"users">[] = [];
  for (const id of [
    ...(last?.authorId !== undefined ? [last.authorId] : []),
    ...thread.participants,
  ]) {
    if (previewIds.length >= CIRCLE_MEMBER_PREVIEW) break;
    if (id !== me && !previewIds.includes(id)) previewIds.push(id);
  }
  return {
    kind: "circle",
    circleId: thread.circleId,
    name: circle.name,
    memberCount: circle.memberships.length,
    memberPreview: await Promise.all(previewIds.map(project)),
  };
};

// Q21: a circle thread shows in a member's inbox only once it has something for them, which the
// row they already hold says without any message read: they opened it (a read receipt), or a
// message they can see arrived since they joined (unread, which skips join/leave rows, rows
// before their floor and authors they blocked), or the visible last message is member-authored
// (also covers their own post). A thread holding only join/leave rows stays out.
const circleRowShows = (
  membership: Doc<"threadParticipants">,
  last: LastMessageSummary | null,
): boolean =>
  membership.lastReadAt !== undefined ||
  (membership.unreadCount ?? 0) > 0 ||
  last?.authorId !== undefined;

// What the thread is about. Exchange: the exchange's identity + type, the requested copy's
// puzzle title (snapshot first, catalog row fallback — same as loanReadViews) and the trading
// partner, through the per-trade chokepoint (tradePartner). DM: the other participant, through the
// privacy chokepoint. Both anonymise salted with the thread id (stable within a thread, un-correlatable across threads). Null only for a corrupt exchange row (subject unresolvable);
// the caller drops the thread rather than fabricating a subject.
const subjectOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
): Promise<InboxThreadSubjectView | null> => {
  if (thread.subjectKind === "exchange") {
    const exchange = thread.exchangeId
      ? await ctx.db.get(thread.exchangeId)
      : null;
    if (!exchange) return null;
    const copy = await ctx.db.get(exchange.requestedPuzzleId);
    const puzzle = copy ? await ctx.db.get(copy.puzzleId) : null;
    // The counterparty comes from the exchange row itself: whichever party is not the viewer.
    const partnerId =
      exchange.initiatorId === me ? exchange.recipientId : exchange.initiatorId;
    return {
      kind: "exchange",
      // The exchange AGGREGATE id, raw-_id fallback for pre-aggregateId rows (the repository's
      // resolveExchangeId in reverse).
      exchangeId: exchange.aggregateId ?? (exchange._id as string),
      exchangeType: exchange.type,
      puzzleTitle: copy?.snapshot?.title ?? puzzle?.title ?? null,
      ...(await tradePartner(ctx, me, exchange, partnerId, thread.aggregateId)),
    };
  }
  const otherId = thread.participants.find((p) => p !== me) ?? me;
  return {
    kind: "dm",
    ...(await projectedOther(ctx, me, otherId, thread.aggregateId)),
  };
};

// The trading partner through the PER-TRADE chokepoint: revealed inside this exchange (limited view
// when only the trade reveals them), else anonymous with the same thread-salted ref a DM subject
// uses. The profile link only for an ordinarily visible partner: a trade reveal never unlocks it.
const tradePartner = async (
  ctx: QueryCtx,
  me: Id<"users">,
  exchange: Doc<"exchanges">,
  partnerId: Id<"users">,
  salt: string,
): Promise<{ otherMember: ProjectedMember; profileHandle: string | null }> => {
  const party = await projectTradeParty(ctx, me, exchange, partnerId);
  const member = tradePartyMemberView(party);
  const otherMember: ProjectedMember = member
    ? { anonymous: false, member }
    : {
        ...(await anonymousMemberOf(ctx, partnerId, salt)),
        ...(party.state === "departed" ? { departed: true as const } : {}),
      };
  const linkable = party.state === "visible" || party.state === "self";
  return {
    otherMember,
    profileHandle: linkable
      ? await profileHandleOf(ctx, otherMember, partnerId)
      : null,
  };
};

const projectedOther = async (
  ctx: QueryCtx,
  me: Id<"users">,
  otherId: Id<"users">,
  salt: string,
): Promise<{ otherMember: ProjectedMember; profileHandle: string | null }> => {
  const otherMember = await projectMemberIdentity(ctx, me, otherId, salt);
  return {
    otherMember,
    profileHandle: await profileHandleOf(ctx, otherMember, otherId),
  };
};

// The other member's /members/<handle> handle, built like the web's links (slug ?? username ??
// id; resolveMemberByHandle resolves all three back to them). Null when the privacy chokepoint
// anonymised them, since the handle itself is identifying. A member revealed only by the
// chokepoint's circle rule DOES get a handle, and their profile renders LOCKED to this viewer
// (getPublicProfile's `unlocked` is self/public/mutual only): acceptable, since the circle reveal is
// identity only. Null too for an inactive account (the chokepoint already anonymises it), which
// the route resolves to "not found".
const profileHandleOf = async (
  ctx: QueryCtx,
  otherMember: ProjectedMember,
  otherId: Id<"users">,
): Promise<string | null> => {
  if (otherMember.anonymous) return null;
  const user = await ctx.db.get(otherId);
  if (!user || !user.isActive) return null;
  return user.slug ?? user.username ?? (user._id as string);
};

// Mutable per-inbox-read count of distinct-copy probes still allowed.
interface ProbeBudget {
  remaining: number;
}

// The thread's distinct referenced copies with their newest reference instant, by skip-scanning
// by_thread_copy_sent: jump to the next copyId, read that copy's newest row, repeat. Reads two
// rows per distinct copy, never the messages in between.
const referencedCopiesOf = async (
  ctx: QueryCtx,
  threadAggregateId: string,
  budget: ProbeBudget,
): Promise<{ copyId: Id<"ownedPuzzles">; sentAt: number }[]> => {
  const found: { copyId: Id<"ownedPuzzles">; sentAt: number }[] = [];
  let after = LOWEST_COPY_ID;
  while (found.length < CONTEXT_COPY_PROBES && budget.remaining > 0) {
    const next = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_copy_sent", (q) =>
        q.eq("threadAggregateId", threadAggregateId).gt("copyId", after),
      )
      .first();
    if (!next?.copyId) break;
    const copyId = next.copyId;
    const newest = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_copy_sent", (q) =>
        q.eq("threadAggregateId", threadAggregateId).eq("copyId", copyId),
      )
      .order("desc")
      .first();
    budget.remaining -= 1;
    found.push({ copyId, sentAt: newest?.sentAt ?? next.sentAt });
    after = copyId;
  }
  return found.sort((a, b) => b.sentAt - a.sentAt);
};

// The distinct viewable context copies, labelled by owner: an exchange's requested then offered
// copy first, then message references newest first. A copy owned by neither participant (legacy
// data) is left out — there is no safe owner label for a third party.
const contextCopiesOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
  resolveCopy: ContextCopyResolver,
  budget: ProbeBudget,
): Promise<InboxThreadContextCopy[]> => {
  const candidates: Id<"ownedPuzzles">[] = [];
  if (thread.subjectKind === "exchange" && thread.exchangeId) {
    const exchange = await ctx.db.get(thread.exchangeId);
    if (exchange) {
      candidates.push(exchange.requestedPuzzleId);
      if (exchange.offeredPuzzleId) candidates.push(exchange.offeredPuzzleId);
    }
  }
  for (const { copyId } of await referencedCopiesOf(
    ctx,
    thread.aggregateId,
    budget,
  )) {
    candidates.push(copyId);
  }

  const contextCopies: InboxThreadContextCopy[] = [];
  const seen = new Set<Id<"ownedPuzzles">>();
  for (const copyId of candidates) {
    if (contextCopies.length >= CONTEXT_COPY_CAP) break;
    if (seen.has(copyId)) continue;
    seen.add(copyId);
    const resolved = await resolveCopy(copyId);
    if (!resolved || !thread.participants.includes(resolved.ownerId)) continue;
    contextCopies.push({
      ...resolved.card,
      owner: resolved.ownerId === me ? "viewer" : "other",
    });
  }
  return contextCopies;
};

const toInboxThreadView = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  membership: Doc<"threadParticipants">,
  me: Id<"users">,
  resolveCopy: ContextCopyResolver,
  budget: ProbeBudget,
): Promise<InboxThreadView | null> => {
  // The denormalized summary; rows the backfill has not reached fall back to reading the message,
  // summarised the same way (so the preview never carries an attachment ref). In a circle thread
  // it is floored at the member's joinedAt.
  const newestRow = thread.lastMessage
    ? null
    : await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) =>
          q.eq("threadAggregateId", thread.aggregateId),
        )
        .order("desc")
        .first();
  const last = visibleLastMessage(
    thread.lastMessage ?? (newestRow ? toLastMessage(newestRow) : null),
    me,
    thread.subjectKind === "circle" ? membership.joinedAt : undefined,
  );
  if (thread.subjectKind === "circle") {
    if (!circleRowShows(membership, last)) return null;
    const subject = await circleSubjectOf(ctx, thread, me, last);
    if (!subject) return null;
    return {
      threadId: thread.aggregateId,
      subject,
      lastMessage: last
        ? {
            ...toLastMessageView(last, me),
            ...(await circleDecorations(ctx, me, thread)(last)),
          }
        : null,
      unreadCount: await participantUnreadCountOf(ctx, thread, membership),
      // Message-referenced copies are not listed for a circle: they would span history from
      // before the member joined.
      contextCopies: [],
      updatedAt: thread.lastMessageAt ?? thread.createdAt,
      ...(membership.muted === true && { muted: true as const }),
      // No block flags: a block between two members never makes a circle thread read-only.
    };
  }
  const subject = await subjectOf(ctx, thread, me);
  if (!subject) return null;
  const contextCopies = await contextCopiesOf(
    ctx,
    thread,
    me,
    resolveCopy,
    budget,
  );
  const otherId = thread.participants.find((p) => p !== me);
  const blocked = otherId
    ? await blockStateBetween(ctx, me, otherId)
    : undefined;
  return {
    threadId: thread.aggregateId,
    subject,
    lastMessage: last ? toLastMessageView(last, me) : null,
    unreadCount: await participantUnreadCountOf(ctx, thread, membership),
    contextCopies,
    updatedAt: thread.lastMessageAt ?? thread.createdAt,
    ...(membership.muted === true && { muted: true as const }),
    // Only the blocker learns of the block; the blocked side just sees a read-only thread.
    ...(blocked === "byMe" ? { blocked } : {}),
    ...(blocked === "byThem" ? { readOnly: true as const } : {}),
  };
};

// The caller's inbox: every thread they participate in, enriched for the list row and sorted
// newest-activity first. A read model over the projection tables — the Thread aggregate is
// never hydrated here.
export const getMyInbox = query({
  args: {},
  handler: async (ctx): Promise<InboxThreadView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const memberships = await ctx.db
      .query("threadParticipants")
      .withIndex("by_member", (q) => q.eq("memberId", me))
      .collect();

    // Per-thread point reads; the last message and unread count are denormalized (the thread's
    // lastMessage, the membership's unreadCount), so no per-row message scans once backfilled.
    const threads: Doc<"threads">[] = [];
    const membershipOf = new Map<string, Doc<"threadParticipants">>();
    for (const membership of memberships) {
      const thread = await threadRowByAggregateId(
        ctx,
        membership.threadAggregateId,
      );
      if (
        thread &&
        (thread.subjectKind !== "circle" ||
          (await inboxListable(ctx, thread, me)))
      ) {
        threads.push(thread);
        membershipOf.set(thread.aggregateId, membership);
      }
    }
    // Newest activity first, so the context-copy probe budget is spent on the top of the inbox.
    const activityOf = (thread: Doc<"threads">) =>
      thread.lastMessageAt ?? thread.createdAt;
    threads.sort((a, b) => activityOf(b) - activityOf(a));

    const views: InboxThreadView[] = [];
    const resolveCopy = viewableContextCopies(ctx, me);
    const budget: ProbeBudget = { remaining: CONTEXT_PROBE_BUDGET };
    for (const thread of threads) {
      const view = await toInboxThreadView(
        ctx,
        thread,
        membershipOf.get(thread.aggregateId)!,
        me,
        resolveCopy,
        budget,
      );
      if (view) {
        views.push(view);
      } else if (thread.subjectKind !== "circle") {
        console.warn(
          `getMyInbox: dropping thread ${thread.aggregateId} — exchange subject no longer resolves`,
        );
      }
    }
    return views.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
