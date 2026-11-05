import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  inboxListable,
  participantUnreadCountOf,
  threadRowByAggregateId,
  UNREAD_SCAN_CAP,
} from "./readModelHelpers";

// Participant rows one badge read looks at, at most. Rows that don't count (their thread no longer
// lists: a deleted exchange, a circle seat already gone) use up the budget too; past it the total is
// what was counted so far, a lower bound.
export const UNREAD_TOTAL_ROW_BUDGET = 100;

// The caller's total unread messages across their threads: the app-shell badge number, capped at
// UNREAD_SCAN_CAP, so 50 means "50 or more" (the web renders "50+"), as for one thread's count.
// Each summand is the count getMyInbox shows for that thread (the membership's denormalized
// unreadCount, scan fallback), and only threads getMyInbox would render count (inboxListable), so
// the badge never shows unread the inbox doesn't. Muted threads are left out (Q9): their row shows a
// grey count.
//
// Bounded (PERF-B6m, SEC-24): it never reads every thread the member holds. by_member_unread lists
// only unmuted rows with unread messages, biggest count first, so the cap is reached in as few rows
// as possible; muted and read threads cost nothing. Rows written before the stored count existed
// (no unreadCount) are read from their own range and counted by the message scan; that range is
// empty once conversation/backfillParticipantState has run.
export const getUnreadTotal = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const unmuted = (unread: "stored" | "legacy") =>
      ctx.db
        .query("threadParticipants")
        .withIndex("by_member_unread", (q) => {
          const mine = q.eq("memberId", me).eq("muted", undefined);
          return unread === "stored"
            ? mine.gt("unreadCount", 0)
            : mine.eq("unreadCount", undefined);
        })
        .order("desc");

    let total = 0;
    let examined = 0;
    const done = () =>
      total >= UNREAD_SCAN_CAP || examined >= UNREAD_TOTAL_ROW_BUDGET;
    for (const range of ["stored", "legacy"] as const) {
      if (done()) break;
      for await (const membership of unmuted(range)) {
        examined += 1;
        total += await listedUnreadOf(ctx, membership, me);
        if (done()) break;
      }
    }
    return Math.min(total, UNREAD_SCAN_CAP);
  },
});

// One membership's unread count, or 0 when its thread is not in the member's inbox.
const listedUnreadOf = async (
  ctx: QueryCtx,
  membership: Doc<"threadParticipants">,
  me: Id<"users">,
): Promise<number> => {
  const thread = await threadRowByAggregateId(
    ctx,
    membership.threadAggregateId,
  );
  return thread && (await inboxListable(ctx, thread, me))
    ? participantUnreadCountOf(ctx, thread, membership)
    : 0;
};
