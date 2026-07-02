import type { ThreadMessageView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

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

/** Message row -> DTO. A system message's absent author column maps to null. */
export const toThreadMessageView = (
  row: Doc<"threadMessages">,
): ThreadMessageView => ({
  id: row.messageId,
  authorId: row.authorId === undefined ? null : (row.authorId as string),
  kind: row.kind,
  body: row.body,
  sentAt: row.sentAt,
});

// Unread counting stops once 50 QUALIFYING (post-receipt, not-own-authored) messages are found,
// so a count of 50 genuinely means "50 or more" and the UI can render it as "50+" — a badge past
// 50 carries no more signal. The cap bounds BOTH getMyInbox (per thread) and getUnreadTotal (per
// summand).
export const UNREAD_SCAN_CAP = 50;

/**
 * The caller's unread count for one thread: messages with `sentAt` strictly after their read
 * receipt (no receipt = everything) that they did not author, counted newest-first until
 * {@link UNREAD_SCAN_CAP} qualifying messages are found — a return of 50 means "50 or more".
 */
export const unreadCountOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
): Promise<number> => {
  const lastReadAt =
    thread.readReceipts.find((receipt) => receipt.memberId === me)
      ?.lastReadAt ?? 0;
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
