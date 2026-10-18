import {
  Thread,
  toExchangeId,
  type ExchangeId,
  type MemberId,
  type ThreadId,
  type ThreadRepository,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { UNREAD_SCAN_CAP, unreadCountOf } from "../readModelHelpers";
import {
  participantsKeyOf,
  toDomain,
  toLastMessage,
  toMessageRow,
  toThreadRow,
  type ThreadMessageRow,
} from "./threadMapper";

// Driven adapter for the ThreadRepository port over `ctx.db`. The only place the `threads`,
// `threadMessages`, and `threadParticipants` tables are read/written for the domain path; the
// mapper is the ACL. Everything here runs inside the caller's single mutation transaction —
// nothing is scheduled or deferred — which is what makes the use cases' check-then-save
// (one thread per exchange, one DM per pair) race-safe under Convex's serializable mutations.
//
// The aggregate is append-only: it hydrates WITHOUT message history (no invariant reads it), so
// a load-mutate-save touches only the thread row, its participant rows (≤ 50) and the appended
// messages. Re-saving the same instance is a no-op for messages already stored (a by_message_id
// point read per appended message, never a history scan).
export const convexThreadRepository = (ctx: MutationCtx): ThreadRepository => {
  const rowById = (id: ThreadId): Promise<Doc<"threads"> | null> =>
    ctx.db
      .query("threads")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  // Resolve the real `exchanges._id` for an Exchange aggregateId; exchanges that predate
  // aggregateId fall back to treating the value as a raw `_id`.
  const resolveExchangeId = async (
    exchangeId: ExchangeId,
  ): Promise<Id<"exchanges">> => {
    const byAggregateId = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", exchangeId as string),
      )
      .unique();
    return byAggregateId
      ? byAggregateId._id
      : (exchangeId as unknown as Id<"exchanges">);
  };

  // Map a stored `exchanges._id` back to its ExchangeId aggregateId for the domain.
  const exchangeAggregateId = async (
    exchangeId: Id<"exchanges"> | undefined,
  ): Promise<ExchangeId | undefined> => {
    if (!exchangeId) return undefined;
    const row = await ctx.db.get(exchangeId);
    return toExchangeId(
      (row?.aggregateId ?? (exchangeId as unknown as string)) as string,
    );
  };

  // The thread's participant rows, which carry the per-member state (read receipt, unread).
  const participantRowsOf = (
    threadAggregateId: string,
  ): Promise<Doc<"threadParticipants">[]> =>
    ctx.db
      .query("threadParticipants")
      .withIndex("by_thread", (q) =>
        q.eq("threadAggregateId", threadAggregateId),
      )
      .collect();

  const hydrate = async (row: Doc<"threads">): Promise<Thread> =>
    Thread.rehydrate(
      toDomain(
        row,
        await participantRowsOf(row.aggregateId),
        row.subjectKind === "exchange"
          ? await exchangeAggregateId(row.exchangeId)
          : undefined,
      ),
    );

  return {
    async findById(threadId: ThreadId): Promise<Thread | null> {
      const row = await rowById(threadId);
      return row ? hydrate(row) : null;
    },

    async findByExchange(exchangeId: ExchangeId): Promise<Thread | null> {
      const exchangeDocId = await resolveExchangeId(exchangeId);
      const row = await ctx.db
        .query("threads")
        .withIndex("by_exchange", (q) => q.eq("exchangeId", exchangeDocId))
        .unique();
      return row ? hydrate(row) : null;
    },

    async findDmByParticipants(
      a: MemberId,
      b: MemberId,
    ): Promise<Thread | null> {
      const row = await ctx.db
        .query("threads")
        .withIndex("by_subject_participants", (q) =>
          q
            .eq("subjectKind", "dm")
            .eq("participantsKey", participantsKeyOf([a, b])),
        )
        .unique();
      return row ? hydrate(row) : null;
    },

    async save(thread: Thread): Promise<void> {
      const state = thread.toState();
      const aggregateId = state.id as string;
      const existing = await rowById(state.id);

      // Every message on the aggregate was appended in this unit of work (hydration starts
      // empty). A point lookup by id skips any already stored by an earlier save of the same
      // instance; only rows actually inserted count toward lastMessage, activity and unread.
      const appended: ThreadMessageRow[] = [];
      for (const message of state.messages) {
        const messageRow = toMessageRow(aggregateId, message);
        const stored = await ctx.db
          .query("threadMessages")
          .withIndex("by_message_id", (q) =>
            q.eq("messageId", messageRow.messageId),
          )
          .first();
        if (stored) continue;
        await ctx.db.insert("threadMessages", messageRow);
        appended.push(messageRow);
      }
      // The newest appended message (a later insert wins a sentAt tie, as in by_thread_sent).
      const newest = appended.reduce<ThreadMessageRow | undefined>(
        (best, m) => (best === undefined || m.sentAt >= best.sentAt ? m : best),
        undefined,
      );
      const storedLastAt = existing?.lastMessageAt;
      // Denormalized inbox-ordering column: the newest message's instant, unset while empty.
      const lastMessageAt =
        newest === undefined
          ? storedLastAt
          : Math.max(storedLastAt ?? newest.sentAt, newest.sentAt);
      const createdAt = existing?.createdAt ?? Date.now();

      // The thread row changes only when it is new, gains messages or its participant set moves —
      // never for a read receipt, so marking read does not re-run every participant's inbox.
      const participantsChanged =
        existing !== null &&
        participantsKeyOf(
          existing.participants.map((p) => p as unknown as MemberId),
        ) !== participantsKeyOf(state.participants);
      const row = {
        ...toThreadRow(thread),
        exchangeId:
          state.subject.kind === "exchange"
            ? await resolveExchangeId(state.subject.exchangeId)
            : undefined,
        lastMessageAt,
        ...(newest !== undefined &&
          newest.sentAt >= (storedLastAt ?? newest.sentAt) && {
            lastMessage: toLastMessage(newest),
          }),
      };
      if (!existing) await ctx.db.insert("threads", { ...row, createdAt });
      else if (newest !== undefined || participantsChanged) {
        await ctx.db.patch(existing._id, row);
      }

      // Participant rows: synced exactly to the aggregate's set (insert missing, delete stale and
      // duplicates), and carrying each member's state. A changed receipt patches only that
      // member's row; appended messages bump every row's activity and every non-author's unread.
      const receiptOf = new Map(
        state.readReceipts.map((r) => [
          r.memberId as string,
          r.lastReadAt.getTime(),
        ]),
      );
      const rowOf = new Map<string, Doc<"threadParticipants">>();
      for (const participantRow of await participantRowsOf(aggregateId)) {
        const memberId = participantRow.memberId as string;
        if (
          state.participants.includes(memberId as MemberId) &&
          !rowOf.has(memberId)
        ) {
          rowOf.set(memberId, participantRow);
        } else {
          await ctx.db.delete(participantRow._id);
        }
      }
      for (const memberId of state.participants) {
        const participantRow = rowOf.get(memberId as string);
        const receipt = receiptOf.get(memberId as string);
        const storedReadAt =
          participantRow?.lastReadAt ??
          existing?.readReceipts?.find(
            (r) => (r.memberId as string) === memberId,
          )?.lastReadAt;
        const patch: Partial<Doc<"threadParticipants">> = {};
        if (receipt !== undefined && receipt !== storedReadAt) {
          patch.lastReadAt = receipt;
          patch.unreadCount = 0;
        }
        if (newest !== undefined) {
          patch.lastActivityAt = lastMessageAt;
          const incoming = appended.filter(
            (m) => (m.authorId as string | undefined) !== memberId,
          ).length;
          // A brand-new row starts at 0. A pre-backfill row without a count derives it once by
          // the capped scan, which already includes the messages inserted above.
          const base = participantRow ? participantRow.unreadCount : 0;
          const unreadCount = patch.unreadCount ?? base;
          patch.unreadCount =
            unreadCount === undefined && existing
              ? await unreadCountOf(
                  ctx,
                  existing,
                  memberId as unknown as Id<"users">,
                  participantRow,
                )
              : Math.min(UNREAD_SCAN_CAP, (unreadCount ?? 0) + incoming);
        }
        if (!participantRow) {
          await ctx.db.insert("threadParticipants", {
            threadAggregateId: aggregateId,
            memberId: memberId as unknown as Id<"users">,
            unreadCount: 0,
            lastActivityAt: lastMessageAt ?? createdAt,
            ...patch,
          });
        } else if (Object.keys(patch).length > 0) {
          await ctx.db.patch(participantRow._id, patch);
        }
      }
    },
  };
};
