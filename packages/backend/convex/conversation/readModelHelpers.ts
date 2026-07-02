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

// Unread counting is capped at the 50 newest qualifying messages so an inbox render never scans
// an unbounded history: a badge past 50 carries no more signal than "50+", and the UI can render
// it that way. The cap bounds BOTH getMyInbox (per thread) and getUnreadTotal (per summand).
export const UNREAD_SCAN_CAP = 50;

/**
 * The caller's unread count for one thread: messages with `sentAt` strictly after their read
 * receipt (no receipt = everything) that they did not author, counted over at most the
 * {@link UNREAD_SCAN_CAP} newest such messages.
 */
export const unreadCountOf = async (
  ctx: QueryCtx,
  thread: Doc<"threads">,
  me: Id<"users">,
): Promise<number> => {
  const lastReadAt =
    thread.readReceipts.find((receipt) => receipt.memberId === me)
      ?.lastReadAt ?? 0;
  const newest = await ctx.db
    .query("threadMessages")
    .withIndex("by_thread_sent", (q) =>
      q.eq("threadAggregateId", thread.aggregateId).gt("sentAt", lastReadAt),
    )
    .order("desc")
    .take(UNREAD_SCAN_CAP);
  return newest.filter((message) => message.authorId !== me).length;
};
