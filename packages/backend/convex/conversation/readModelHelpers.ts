import type { ThreadMessageView } from "@jigswap/contracts";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isUnattachedMedia } from "./adapters/threadMapper";
import { viewableCopyCards } from "./copyCard";
import { messageAttachmentViews } from "./messageAttachments";
import { locationAttachmentViewOf } from "./sharedLocations";
import { threadMemberProjector } from "./threadMemberProjection";

// Shared row->DTO mapping and unread logic for the conversation read models. Read models page
// the companion `threadMessages` rows via `by_thread_sent` directly and NEVER hydrate the Thread
// aggregate — hydration replays the full message history, which is exactly what reads must avoid.

/** The `threads` row for a Thread aggregateId, or null. */
export const threadRowByAggregateId = (
  ctx: QueryCtx,
  threadAggregateId: string,
): Promise<Doc<"threads"> | null> =>
  ctx.db
    .query("threads")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadAggregateId))
    .unique();

/** The member's participant row in a thread, or null. */
export const participantRowOf = (
  ctx: QueryCtx,
  threadAggregateId: string,
  memberId: Id<"users">,
): Promise<Doc<"threadParticipants"> | null> =>
  ctx.db
    .query("threadParticipants")
    .withIndex("by_thread_member", (q) =>
      q.eq("threadAggregateId", threadAggregateId).eq("memberId", memberId),
    )
    .first();

/**
 * The thread a member may read, and their history floor in it: ThreadNotFound for no thread,
 * NotParticipant for anyone who isn't one of its participants. A circle thread additionally
 * requires a CURRENT circle membership (the participant set follows the circle asynchronously,
 * so a member who just left or was removed is refused even before the sync ran), and its
 * `floor` is circleFloorOf: they see only messages sent strictly after it. Exchange/DM threads
 * have no floor.
 */
export const readableThreadOf = async (
  ctx: QueryCtx,
  threadAggregateId: string,
  me: Id<"users">,
): Promise<{ thread: Doc<"threads">; floor: number | undefined }> => {
  const thread = await threadRowByAggregateId(ctx, threadAggregateId);
  if (!thread) {
    throw new ConvexError({
      code: "ThreadNotFound",
      message: "Thread not found",
    });
  }
  const notParticipant = new ConvexError({
    code: "NotParticipant",
    message: "Only participants may read a thread",
  });
  if (!thread.participants.includes(me)) throw notParticipant;
  if (thread.subjectKind !== "circle") return { thread, floor: undefined };
  const floor = await circleFloorOf(ctx, thread, me);
  if (floor === null) throw notParticipant;
  return { thread, floor };
};

/**
 * A member's history floor in a circle thread (they see only messages sent strictly after it),
 * or null when they may see nothing of it: no current seat in the circle, no participant row, or
 * a row without a joinedAt (fails closed). The floor is the LATER of the row's joinedAt and the
 * seat's: after a leave and re-join whose sync is still pending (or arrived out of order), the
 * row can still carry the old join time, and the seat's newer one must win.
 */
export const circleFloorOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  memberId: Id<"users">,
): Promise<number | null> => {
  if (thread.subjectKind !== "circle" || thread.circleId === undefined) {
    return null;
  }
  const circle = await circleRowOf(ctx, thread.circleId);
  const seat = circle?.memberships.find((m) => m.memberId === memberId);
  if (!seat) return null;
  const participant = await participantRowOf(ctx, thread.aggregateId, memberId);
  if (participant?.joinedAt === undefined) return null;
  return Math.max(participant.joinedAt, seat.joinedAt);
};

/**
 * The viewer's own "joined" row(s) in a circle thread: the join/leave row naming them, sent at
 * exactly their floor. The strict `sentAt > joinedAt` floor hides it, and this is the ONE
 * exemption, so a joiner sees "You joined" above the history they may read. An index point range
 * on the floor instant; any other row sent at that instant stays hidden.
 */
export const ownJoinRowsAt = async (
  ctx: QueryCtx,
  threadAggregateId: string,
  me: Id<"users">,
  floor: number,
): Promise<Doc<"threadMessages">[]> =>
  (
    await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) =>
        q.eq("threadAggregateId", threadAggregateId).eq("sentAt", floor),
      )
      .collect()
  ).filter(
    (row) =>
      row.kind === "system" &&
      row.systemEvent?.kind === "joined" &&
      row.systemEvent.memberId === me,
  );

/** The members the viewer blocked (their own block rows, never the reverse direction). */
export const blockedByMeSet = async (
  ctx: QueryCtx,
  me: Id<"users">,
): Promise<Set<Id<"users">>> =>
  new Set(
    (
      await ctx.db
        .query("blocks")
        .withIndex("by_blocker", (q) => q.eq("blockerId", me))
        .collect()
    ).map((row) => row.blockedId),
  );

// The message columns a DTO is built from.
type MessageFields = Pick<
  Doc<"threadMessages">,
  | "messageId"
  | "authorId"
  | "kind"
  | "body"
  | "sentAt"
  | "attachmentId"
  | "removedAt"
  | "tradeEvent"
>;

type TradeEvent = NonNullable<Doc<"threadMessages">["tradeEvent"]>;

// The English bodies trade lifecycle rows were written with before they carried a `tradeEvent`
// (conversation/subscriber and the account-deletion purge wrote exactly these strings, and the
// legacy-chat backfill copied the same ones), so those rows render translated too.
const LEGACY_TRADE_EVENT_BODIES: Readonly<Record<string, TradeEvent["kind"]>> =
  {
    "Exchange proposed": "proposed",
    "Exchange accepted": "accepted",
    "Exchange rejected": "rejected",
    "Exchange cancelled": "cancelled",
    "Exchange completed": "completed",
    "Exchange cancelled: the other member deleted their account":
      "cancelled_member_deleted",
  };

/**
 * A system row's trade lifecycle step: its stored `tradeEvent`, or, for a row written before
 * that existed, the step its English body names. Undefined for any other row (the client then
 * shows the body as-is).
 */
export const tradeEventOf = (
  row: Pick<MessageFields, "kind" | "body" | "tradeEvent">,
): TradeEvent | undefined => {
  if (row.kind !== "system") return undefined;
  if (row.tradeEvent !== undefined) return row.tradeEvent;
  return Object.prototype.hasOwnProperty.call(
    LEGACY_TRADE_EVENT_BODIES,
    row.body,
  )
    ? { kind: LEGACY_TRADE_EVENT_BODIES[row.body] }
    : undefined;
};

/**
 * Message row -> DTO for viewer `me`. Authorship is viewer-relative (`isMine`); the raw author id
 * never leaves the server (it would de-anonymise a hidden member). A system message's absent
 * author column is never `me`, so it maps to `isMine: false`. A media row (image/location) carries
 * its caption as `body` plus its `attachmentId`. A media row WITHOUT an attachment has its body
 * BLANKED: `postMessage` no longer accepts images, and any legacy image row's body is an
 * unverified, client-supplied string (never screened or ownership-checked), so it must never reach
 * a renderer. A moderator-removed message keeps its slot but carries an empty body, no
 * attachment ref and `removed: true`.
 *
 * Seam: the attachments PR resolves `attachmentId` into an `attachment` view (status, URLs) for
 * the reader in threadMessageViewOf, the way `copyId` resolves into `copy`.
 */
export const toThreadMessageView = (
  row: MessageFields,
  me: Id<"users">,
): ThreadMessageView => {
  const tradeEvent = tradeEventOf(row);
  return {
    id: row.messageId,
    isMine: row.authorId === me,
    kind: row.kind,
    body: isUnattachedMedia(row) || row.removedAt !== undefined ? "" : row.body,
    sentAt: row.sentAt,
    ...(row.removedAt !== undefined
      ? { removed: true as const }
      : row.attachmentId !== undefined && { attachmentId: row.attachmentId }),
    ...(tradeEvent !== undefined && { tradeEvent }),
  };
};

/**
 * A thread's denormalized `lastMessage` summary -> the inbox preview DTO. The summary was
 * sanitized when written (toLastMessage: truncated, unattached media blanked) and never carries an
 * attachment ref, so its body is used as-is.
 */
export const toLastMessageView = (
  summary: NonNullable<Doc<"threads">["lastMessage"]>,
  me: Id<"users">,
): ThreadMessageView => {
  const tradeEvent = tradeEventOf(summary);
  return {
    id: summary.messageId,
    isMine: summary.authorId === me,
    kind: summary.kind,
    body: summary.body,
    sentAt: summary.sentAt,
    ...(summary.removed && { removed: true as const }),
    ...(tradeEvent !== undefined && { tradeEvent }),
  };
};

// Unread counting stops once 50 QUALIFYING (post-receipt, not-own-authored) messages are found,
// so a count of 50 genuinely means "50 or more" and the UI can render it as "50+" — a badge past
// 50 carries no more signal. The cap bounds BOTH getMyInbox (per thread) and getUnreadTotal (per
// summand).
export const UNREAD_SCAN_CAP = 50;

// The scan also stops after reading this many rows, so a member who authored a long run of their
// own messages after their receipt cannot make it read without bound. Past it the count is a
// lower bound (see unreadCountOf).
export const UNREAD_SCAN_READ_CAP = 500;

/**
 * The member's read receipt: their participant row's `lastReadAt`, falling back to the legacy
 * `threads.readReceipts` entry until conversation/backfillParticipantState has run. 0 = never read.
 */
export const lastReadAtOf = (
  thread: Doc<"threads">,
  me: Id<"users">,
  participant?: Doc<"threadParticipants">,
): number =>
  participant?.lastReadAt ??
  thread.readReceipts?.find((receipt) => receipt.memberId === me)?.lastReadAt ??
  0;

/**
 * The caller's unread count for one thread: messages with `sentAt` strictly after their read
 * receipt (no receipt = everything) that they did not author, counted newest-first until
 * {@link UNREAD_SCAN_CAP} qualifying messages are found — a return of 50 means "50 or more". It
 * reads at most {@link UNREAD_SCAN_READ_CAP} rows; if that cap stops it first, the result is what
 * it counted so far, a lower bound.
 */
export const unreadCountOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
  participant?: Doc<"threadParticipants">,
): Promise<number> => {
  const lastReadAt = lastReadAtOf(thread, me, participant);
  const newestFirst = ctx.db
    .query("threadMessages")
    .withIndex("by_thread_sent", (q) =>
      q.eq("threadAggregateId", thread.aggregateId).gt("sentAt", lastReadAt),
    )
    .order("desc");
  let count = 0;
  let read = 0;
  for await (const message of newestFirst) {
    read += 1;
    if (message.authorId !== me) count += 1;
    if (count >= UNREAD_SCAN_CAP || read >= UNREAD_SCAN_READ_CAP) break;
  }
  return count;
};

/**
 * A participant's unread count: the denormalized `unreadCount` on their row, falling back to the
 * {@link unreadCountOf} scan for rows conversation/backfillParticipantState has not reached.
 */
export const participantUnreadCountOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  participant: Doc<"threadParticipants">,
): Promise<number> =>
  participant.unreadCount ??
  unreadCountOf(ctx, thread, participant.memberId, participant);

/**
 * Whether a thread's subject would render in the inbox: DMs always do; an exchange thread's
 * subject resolves only while its exchange row exists. getMyInbox drops threads failing this,
 * so getUnreadTotal must skip the same threads — otherwise the shell badge would count unread
 * the inbox never shows.
 */
export const subjectRenders = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
): Promise<boolean> => {
  if (thread.subjectKind === "circle") {
    return (
      thread.circleId !== undefined &&
      (await circleRowOf(ctx, thread.circleId)) !== null
    );
  }
  return (
    thread.subjectKind !== "exchange" ||
    (thread.exchangeId !== undefined &&
      (await ctx.db.get(thread.exchangeId)) !== null)
  );
};

/** A circle's row by its CircleId aggregateId, or null once it is deleted. */
export const circleRowOf = (
  ctx: QueryCtx,
  circleId: string,
): Promise<Doc<"circles"> | null> =>
  ctx.db
    .query("circles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
    .unique();

/**
 * Whether a thread the member has a participant row in belongs in their inbox and badge: its
 * subject renders (subjectRenders) and, for a circle thread, they may read it at all
 * (circleFloorOf: a current seat and a floor; a leaver's row is deleted by the async sync, and
 * this closes the gap before it runs).
 */
export const inboxListable = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
): Promise<boolean> =>
  (await subjectRenders(ctx, thread)) &&
  (thread.subjectKind !== "circle" ||
    (await circleFloorOf(ctx, thread, me)) !== null);

/**
 * A thread's lastMessage summary as `me` may see it: in a circle thread only a message sent
 * strictly after their joinedAt (`floor`), or their own "joined" row at it; otherwise null, so a
 * new member never sees a snippet from before they joined. Exchange/DM summaries pass through.
 */
export const visibleLastMessage = (
  summary: NonNullable<Doc<"threads">["lastMessage"]> | null,
  me: Id<"users">,
  floor: number | undefined,
): NonNullable<Doc<"threads">["lastMessage"]> | null => {
  if (!summary || floor === undefined || summary.sentAt > floor) return summary;
  const ownJoin =
    summary.sentAt === floor &&
    summary.systemEvent?.kind === "joined" &&
    summary.systemEvent.memberId === me;
  return ownJoin ? summary : null;
};

/**
 * Per-request mapper from a message row to the reader's DTO. A copy reference surfaces as a card
 * only while the reader may view the copy; otherwise as `copyUnavailable`, never revealing
 * anything about the copy. An image message carries its photo as this reader may see it
 * (messageAttachmentViews), a location message its place (locationAttachmentViewOf). In a circle
 * thread each message also carries its projected `author` (projectThreadMember), the
 * `authorBlockedByMe` flag, and a join/leave row its `systemEvent` (circleDecorations). Shared by
 * getThreadMessages and listThreadMessages.
 */
export const threadMessageViewOf = (
  ctx: QueryCtx,
  me: Id<"users">,
  thread: Doc<"threads">,
) => {
  const cardOf = viewableCopyCards(ctx, me);
  const attachmentOf = messageAttachmentViews(ctx, me);
  const decorate =
    thread.subjectKind === "circle"
      ? circleDecorations(ctx, me, thread)
      : undefined;
  return async (row: Doc<"threadMessages">): Promise<ThreadMessageView> => {
    const base = {
      ...toThreadMessageView(row, me),
      ...(decorate && (await decorate(row))),
    };
    const attached =
      row.attachmentId !== undefined && row.removedAt === undefined
        ? row.attachmentId
        : undefined;
    const location =
      row.kind === "location" && attached
        ? await locationAttachmentViewOf(ctx, attached)
        : null;
    const view =
      row.kind === "image" && attached
        ? { ...base, attachment: await attachmentOf(attached) }
        : location
          ? { ...base, attachment: location }
          : base;
    // A removed message renders only as "Message removed": no copy card, no copyUnavailable.
    if (!row.copyId || row.removedAt !== undefined) return view;
    const copy = await cardOf(row.copyId);
    // A reference the reader can no longer follow (deleted, or no longer viewable) is
    // flagged rather than dropped, so the UI can say "no longer available".
    return copy
      ? { ...view, copy }
      : { ...view, copyUnavailable: true as const };
  };
};

type CircleDecoration = Pick<
  ThreadMessageView,
  "author" | "authorBlockedByMe" | "systemEvent"
>;

/**
 * The circle-thread fields of a message DTO, for viewer `me` (a current member: the read gate ran
 * first). `author`: the author through projectThreadMember. `authorBlockedByMe`: the viewer
 * blocked the author (the blocked side is never told). `systemEvent`: who joined or left, named
 * only when the viewer could otherwise see them (projectThreadMember reveals them: a current
 * co-member, or the ordinary rules), else no member ("A member joined/left"). The remover of a
 * removed member is never stored, so it can't leak. Also used for the inbox's lastMessage.
 */
export const circleDecorations = (
  ctx: QueryCtx,
  me: Id<"users">,
  thread: Doc<"threads">,
) => {
  const project = threadMemberProjector(ctx, me, thread);
  let blocked: Promise<Set<Id<"users">>> | undefined;
  return async (
    row: Pick<Doc<"threadMessages">, "authorId" | "systemEvent">,
  ): Promise<CircleDecoration> => {
    if (row.systemEvent !== undefined) {
      const member = await project(row.systemEvent.memberId);
      return {
        systemEvent: {
          kind: row.systemEvent.kind,
          ...(!member.anonymous && { member }),
        },
      };
    }
    if (row.authorId === undefined) return {};
    blocked ??= blockedByMeSet(ctx, me);
    return {
      author: await project(row.authorId),
      ...((await blocked).has(row.authorId) && {
        authorBlockedByMe: true as const,
      }),
    };
  };
};
