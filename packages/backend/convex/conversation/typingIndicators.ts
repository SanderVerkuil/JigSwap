import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Typing indicators (spec 4.3): one row per (thread, member), refreshed by setTyping and read by
// getTyping. Shared constants and row helpers.

/** A row older than this no longer means "is typing". */
export const TYPING_TTL_MS = 6_000;

/** setTyping skips its write when the caller's row was refreshed less than this long ago. */
export const TYPING_THROTTLE_MS = 2_000;

/** getTyping reads at most this many rows of a thread (a circle thread has at most 50 members). */
export const MAX_TYPING_ROWS = 50;

/** One typing write in this many emits the bandwidth wide event (sample_rate on the line). */
export const TYPING_LOG_SAMPLE_RATE = 10;

/** The member's typing row in a thread, or null. */
export const typingRowOf = (
  ctx: QueryCtx,
  threadAggregateId: string,
  memberId: Id<"users">,
): Promise<Doc<"typingIndicators"> | null> =>
  ctx.db
    .query("typingIndicators")
    .withIndex("by_thread_member", (q) =>
      q.eq("threadAggregateId", threadAggregateId).eq("memberId", memberId),
    )
    .first();

/** Delete the member's typing row in a thread, if any: on send, clearTyping and leaving. */
export const clearTypingOf = async (
  ctx: MutationCtx,
  threadAggregateId: string,
  memberId: Id<"users">,
): Promise<void> => {
  const row = await typingRowOf(ctx, threadAggregateId, memberId);
  if (row) await ctx.db.delete(row._id);
};
