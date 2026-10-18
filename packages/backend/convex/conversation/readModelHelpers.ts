import type { ThreadMessageView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isUnattachedMedia } from "./adapters/threadMapper";
import { viewableCopyCards } from "./copyCard";
import { messageAttachmentViews } from "./messageAttachments";

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
>;

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
): ThreadMessageView => ({
  id: row.messageId,
  isMine: row.authorId === me,
  kind: row.kind,
  body: isUnattachedMedia(row) || row.removedAt !== undefined ? "" : row.body,
  sentAt: row.sentAt,
  ...(row.removedAt !== undefined
    ? { removed: true as const }
    : row.attachmentId !== undefined && { attachmentId: row.attachmentId }),
});

/**
 * A thread's denormalized `lastMessage` summary -> the inbox preview DTO. The summary was
 * sanitized when written (toLastMessage: truncated, unattached media blanked) and never carries an
 * attachment ref, so its body is used as-is.
 */
export const toLastMessageView = (
  summary: NonNullable<Doc<"threads">["lastMessage"]>,
  me: Id<"users">,
): ThreadMessageView => ({
  id: summary.messageId,
  isMine: summary.authorId === me,
  kind: summary.kind,
  body: summary.body,
  sentAt: summary.sentAt,
  ...(summary.removed && { removed: true as const }),
});

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
): Promise<boolean> =>
  thread.subjectKind !== "exchange" ||
  (thread.exchangeId !== undefined &&
    (await ctx.db.get(thread.exchangeId)) !== null);

/**
 * Per-request mapper from a message row to the reader's DTO. A copy reference surfaces as a card
 * only while the reader may view the copy; otherwise as `copyUnavailable`, never revealing
 * anything about the copy. An image message carries its photo as this reader may see it
 * (messageAttachmentViews). Shared by getThreadMessages and listThreadMessages.
 */
export const threadMessageViewOf = (ctx: QueryCtx, me: Id<"users">) => {
  const cardOf = viewableCopyCards(ctx, me);
  const attachmentOf = messageAttachmentViews(ctx, me);
  return async (row: Doc<"threadMessages">): Promise<ThreadMessageView> => {
    const base = toThreadMessageView(row, me);
    const view =
      row.kind === "image" &&
      row.attachmentId !== undefined &&
      row.removedAt === undefined
        ? { ...base, attachment: await attachmentOf(row.attachmentId) }
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
