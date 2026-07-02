import type {
  InboxThreadSubjectView,
  InboxThreadView,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { projectMemberIdentity } from "../social/privacy";
import {
  threadRowByAggregateId,
  toThreadMessageView,
  unreadCountOf,
} from "./readModelHelpers";

// What the thread is about. Exchange: the exchange's identity + type and the requested copy's
// puzzle title (snapshot first, catalog row fallback — same as loanReadViews). DM: the other
// participant through the privacy chokepoint, salted with the thread id (stable within a thread,
// un-correlatable across threads). Null only for a corrupt exchange row (subject unresolvable);
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
    return {
      kind: "exchange",
      // The exchange AGGREGATE id, raw-_id fallback for pre-aggregateId rows (the repository's
      // resolveExchangeId in reverse).
      exchangeId: exchange.aggregateId ?? (exchange._id as string),
      exchangeType: exchange.type,
      puzzleTitle: copy?.snapshot?.title ?? puzzle?.title ?? null,
    };
  }
  const otherId = thread.participants.find((p) => p !== me) ?? me;
  return {
    kind: "dm",
    otherMember: await projectMemberIdentity(
      ctx,
      me,
      otherId,
      thread.aggregateId,
    ),
  };
};

const toInboxThreadView = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
): Promise<InboxThreadView | null> => {
  const subject = await subjectOf(ctx, thread, me);
  if (!subject) return null;
  const last = await ctx.db
    .query("threadMessages")
    .withIndex("by_thread_sent", (q) =>
      q.eq("threadAggregateId", thread.aggregateId),
    )
    .order("desc")
    .first();
  return {
    threadId: thread.aggregateId,
    subject,
    lastMessage: last ? toThreadMessageView(last) : null,
    unreadCount: await unreadCountOf(ctx, thread, me),
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

    const views: InboxThreadView[] = [];
    for (const membership of memberships) {
      const thread = await threadRowByAggregateId(
        ctx,
        membership.threadAggregateId,
      );
      if (!thread) continue;
      const view = await toInboxThreadView(ctx, thread, me);
      if (view) views.push(view);
    }
    return views.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
