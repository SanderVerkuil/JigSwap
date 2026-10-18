import type { ThreadMessageView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { viewableCopyCards } from "./copyCard";

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

// The message columns a DTO is built from: a `threadMessages` row or a thread's denormalized
// `lastMessage` summary.
type MessageFields = Pick<
  Doc<"threadMessages">,
  "messageId" | "authorId" | "kind" | "body" | "sentAt"
>;

/**
 * Message row -> DTO for viewer `me`. Authorship is viewer-relative (`isMine`); the raw author id
 * never leaves the server (it would de-anonymise a hidden member). A system message's absent
 * author column is never `me`, so it maps to `isMine: false`. An `image` row's body is BLANKED:
 * `postMessage` no longer accepts images, and any legacy image row's body is an unverified,
 * client-supplied string (never screened or ownership-checked), so it must never reach a renderer.
 */
export const toThreadMessageView = (
  row: MessageFields,
  me: Id<"users">,
): ThreadMessageView => ({
  id: row.messageId,
  isMine: row.authorId === me,
  kind: row.kind,
  body: row.kind === "image" ? "" : row.body,
  sentAt: row.sentAt,
});

// Unread counting stops once 50 QUALIFYING (post-receipt, not-own-authored) messages are found,
// so a count of 50 genuinely means "50 or more" and the UI can render it as "50+" — a badge past
// 50 carries no more signal. The cap bounds BOTH getMyInbox (per thread) and getUnreadTotal (per
// summand).
export const UNREAD_SCAN_CAP = 50;

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
 * {@link UNREAD_SCAN_CAP} qualifying messages are found — a return of 50 means "50 or more".
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
  for await (const message of newestFirst) {
    if (message.authorId === me) continue;
    count += 1;
    if (count >= UNREAD_SCAN_CAP) break;
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
): Promise<boolean> =>
  thread.subjectKind !== "exchange" ||
  (thread.exchangeId !== undefined &&
    (await ctx.db.get(thread.exchangeId)) !== null);

/**
 * Per-request mapper from a message row to the reader's DTO. A copy reference surfaces as a card
 * only while the reader may view the copy; otherwise as `copyUnavailable`, never revealing
 * anything about the copy. Shared by getThreadMessages and listThreadMessages.
 */
export const threadMessageViewOf = (ctx: QueryCtx, me: Id<"users">) => {
  const cardOf = viewableCopyCards(ctx, me);
  return async (row: Doc<"threadMessages">): Promise<ThreadMessageView> => {
    const view = toThreadMessageView(row, me);
    if (!row.copyId) return view;
    const copy = await cardOf(row.copyId);
    // A reference the reader can no longer follow (deleted, or no longer viewable) is
    // flagged rather than dropped, so the UI can say "no longer available".
    return copy
      ? { ...view, copy }
      : { ...view, copyUnavailable: true as const };
  };
};
