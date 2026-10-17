import type {
  InboxThreadContextCopy,
  InboxThreadSubjectView,
  InboxThreadView,
  ProjectedMember,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { projectMemberIdentity } from "../social/privacy";
import { viewableContextCopies } from "./copyCard";
import {
  threadRowByAggregateId,
  toThreadMessageView,
  unreadCountOf,
} from "./readModelHelpers";

// Context-copy bounds. Per thread: at most CONTEXT_COPY_CAP distinct viewable copies, found by
// scanning at most the newest CONTEXT_SCAN_PER_THREAD messages, stopping early once the cap is
// reached. Per inbox read: at most CONTEXT_SCAN_BUDGET messages in total, spent on threads in
// newest-activity order — so a member with many long, copy-less threads cannot push the query
// past Convex's read limits; once spent, the remaining (least recent) threads read only their
// newest message (for lastMessage) and list just their exchange copies.
const CONTEXT_COPY_CAP = 10;
const CONTEXT_SCAN_PER_THREAD = 500;
const CONTEXT_SCAN_BUDGET = 3000;

type ContextCopyResolver = ReturnType<typeof viewableContextCopies>;

// What the thread is about. Exchange: the exchange's identity + type, the requested copy's
// puzzle title (snapshot first, catalog row fallback — same as loanReadViews) and the trading
// partner. DM: the other participant. Both project the other member through the privacy
// chokepoint, salted with the thread id (stable within a thread, un-correlatable across threads). Null only for a corrupt exchange row (subject unresolvable);
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
      ...(await projectedOther(ctx, me, partnerId, thread.aggregateId)),
    };
  }
  const otherId = thread.participants.find((p) => p !== me) ?? me;
  return {
    kind: "dm",
    ...(await projectedOther(ctx, me, otherId, thread.aggregateId)),
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
// anonymised them: their profile would render LOCKED to this viewer (getPublicProfile's
// `unlocked` is the same self/public/mutual rule), and the handle itself is identifying. Null
// too for an inactive account, which the route resolves to "not found".
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

// Mutable per-inbox-read count of messages the context scans may still read.
interface ScanBudget {
  remaining: number;
}

// One pass over the thread's newest messages yielding the newest message (lastMessage) and the
// distinct viewable context copies: an exchange's requested then offered copy first, then
// message references newest first. Stops at CONTEXT_COPY_CAP copies or the scan bound.
const scanThread = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  resolveCopy: ContextCopyResolver,
  budget: ScanBudget,
): Promise<{
  last: Doc<"threadMessages"> | null;
  contextCopies: InboxThreadContextCopy[];
}> => {
  const contextCopies: InboxThreadContextCopy[] = [];
  const seen = new Set<Id<"ownedPuzzles">>();
  const consider = async (copyId: Id<"ownedPuzzles">) => {
    if (seen.has(copyId) || contextCopies.length >= CONTEXT_COPY_CAP) return;
    seen.add(copyId);
    const copy = await resolveCopy(copyId);
    if (copy) contextCopies.push(copy);
  };

  if (thread.subjectKind === "exchange" && thread.exchangeId) {
    const exchange = await ctx.db.get(thread.exchangeId);
    if (exchange) {
      await consider(exchange.requestedPuzzleId);
      if (exchange.offeredPuzzleId) await consider(exchange.offeredPuzzleId);
    }
  }

  // Always read at least one message so lastMessage survives an exhausted budget.
  const limit = Math.max(
    1,
    Math.min(CONTEXT_SCAN_PER_THREAD, budget.remaining),
  );
  let last: Doc<"threadMessages"> | null = null;
  let scanned = 0;
  const newestFirst = ctx.db
    .query("threadMessages")
    .withIndex("by_thread_sent", (q) =>
      q.eq("threadAggregateId", thread.aggregateId),
    )
    .order("desc");
  for await (const message of newestFirst) {
    scanned += 1;
    last ??= message;
    if (message.copyId) await consider(message.copyId);
    if (contextCopies.length >= CONTEXT_COPY_CAP || scanned >= limit) break;
  }
  budget.remaining = Math.max(0, budget.remaining - scanned);
  return { last, contextCopies };
};

const toInboxThreadView = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
  resolveCopy: ContextCopyResolver,
  budget: ScanBudget,
): Promise<InboxThreadView | null> => {
  const subject = await subjectOf(ctx, thread, me);
  if (!subject) return null;
  const { last, contextCopies } = await scanThread(
    ctx,
    thread,
    resolveCopy,
    budget,
  );
  return {
    threadId: thread.aggregateId,
    subject,
    lastMessage: last ? toThreadMessageView(last) : null,
    unreadCount: await unreadCountOf(ctx, thread, me),
    contextCopies,
    updatedAt: thread.lastMessageAt ?? thread.createdAt,
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

    // v1 scaling assumption: per-thread point reads + a capped unread scan per inbox render;
    // when this gets hot, denormalize unreadCount onto threadParticipants instead.
    const threads: Doc<"threads">[] = [];
    for (const membership of memberships) {
      const thread = await threadRowByAggregateId(
        ctx,
        membership.threadAggregateId,
      );
      if (thread) threads.push(thread);
    }
    // Newest activity first, so the context-scan budget is spent on the top of the inbox.
    const activityOf = (thread: Doc<"threads">) =>
      thread.lastMessageAt ?? thread.createdAt;
    threads.sort((a, b) => activityOf(b) - activityOf(a));

    const views: InboxThreadView[] = [];
    const resolveCopy = viewableContextCopies(ctx, me);
    const budget: ScanBudget = { remaining: CONTEXT_SCAN_BUDGET };
    for (const thread of threads) {
      const view = await toInboxThreadView(
        ctx,
        thread,
        me,
        resolveCopy,
        budget,
      );
      if (view) {
        views.push(view);
      } else {
        console.warn(
          `getMyInbox: dropping thread ${thread.aggregateId} — exchange subject no longer resolves`,
        );
      }
    }
    return views.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
