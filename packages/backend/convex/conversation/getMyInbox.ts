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

// How far back a DM looks for the copy it is "about": the newest 50 messages (same bound as
// UNREAD_SCAN_CAP). A copy referenced only further back no longer frames the conversation.
const CONTEXT_COPY_SCAN_CAP = 50;

type ContextCopyResolver = ReturnType<typeof viewableContextCopies>;

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
  const otherMember = await projectMemberIdentity(
    ctx,
    me,
    otherId,
    thread.aggregateId,
  );
  return {
    kind: "dm",
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

// The copy the thread is about, only while the viewer may view it. Exchange: the requested copy.
// DM: the most recent message among `recent` (newest first) referencing a viewable copy.
const contextCopyOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  recent: Doc<"threadMessages">[],
  resolveCopy: ContextCopyResolver,
): Promise<InboxThreadContextCopy | null> => {
  if (thread.subjectKind === "exchange") {
    const exchange = thread.exchangeId
      ? await ctx.db.get(thread.exchangeId)
      : null;
    return exchange ? resolveCopy(exchange.requestedPuzzleId) : null;
  }
  for (const message of recent) {
    if (!message.copyId) continue;
    const copy = await resolveCopy(message.copyId);
    if (copy) return copy;
  }
  return null;
};

const toInboxThreadView = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
  resolveCopy: ContextCopyResolver,
): Promise<InboxThreadView | null> => {
  const subject = await subjectOf(ctx, thread, me);
  if (!subject) return null;
  const recent = await ctx.db
    .query("threadMessages")
    .withIndex("by_thread_sent", (q) =>
      q.eq("threadAggregateId", thread.aggregateId),
    )
    .order("desc")
    .take(CONTEXT_COPY_SCAN_CAP);
  const last = recent[0];
  return {
    threadId: thread.aggregateId,
    subject,
    lastMessage: last ? toThreadMessageView(last) : null,
    unreadCount: await unreadCountOf(ctx, thread, me),
    contextCopy: await contextCopyOf(ctx, thread, recent, resolveCopy),
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
    const views: InboxThreadView[] = [];
    const resolveCopy = viewableContextCopies(ctx, me);
    for (const membership of memberships) {
      const thread = await threadRowByAggregateId(
        ctx,
        membership.threadAggregateId,
      );
      if (!thread) continue;
      const view = await toInboxThreadView(ctx, thread, me, resolveCopy);
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
