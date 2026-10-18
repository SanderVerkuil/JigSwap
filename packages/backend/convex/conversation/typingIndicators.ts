import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logEvent } from "../lib/logEvent";

// Typing indicators (spec 4.3): one row per (thread, member), refreshed by setTyping, stopped by
// clearTyping and read by getTyping. Shared constants and row helpers.

/** A `typingAt` older than this no longer means "is typing". */
export const TYPING_TTL_MS = 6_000;

/** A member's typing row takes at most one write (set or clear) per this long. */
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

/** Whether the row currently says "is typing" at `now`. */
export const isTypingAt = <Row extends { typingAt?: number }>(
  row: Row,
  now: number,
): row is Row & { typingAt: number } =>
  row.typingAt !== undefined && now - row.typingAt < TYPING_TTL_MS;

/**
 * Delete the member's typing row in a thread, if any: on send and on leaving a circle. (A stop,
 * clearTyping, keeps the row so its throttle holds.)
 */
export const deleteTypingRowOf = async (
  ctx: MutationCtx,
  threadAggregateId: string,
  memberId: Id<"users">,
): Promise<void> => {
  const row = await typingRowOf(ctx, threadAggregateId, memberId);
  if (row) await ctx.db.delete(row._id);
};

/**
 * The bandwidth counter (spec R.2 Q19), one sampled wide event per typing write, reviewed in
 * Axiom: multiply counts by sample_rate. Deliberately no member or thread id: a per-member typing
 * log would be an activity history (spec 5.6).
 */
export const logTypingWrite = (
  write: "insert" | "patch" | "clear",
  threadKind?: Doc<"threads">["subjectKind"],
): void => {
  if (Math.random() < 1 / TYPING_LOG_SAMPLE_RATE) {
    logEvent({
      event: "conversation.setTyping",
      outcome: "success",
      write,
      ...(threadKind !== undefined && { thread_kind: threadKind }),
      sample_rate: TYPING_LOG_SAMPLE_RATE,
    });
  }
};
