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
import {
  participantsKeyOf,
  toDomain,
  toMessageRow,
  toThreadRow,
} from "./threadMapper";

// Driven adapter for the ThreadRepository port over `ctx.db`. The only place the `threads`,
// `threadMessages`, and `threadParticipants` tables are read/written for the domain path; the
// mapper is the ACL. Everything here runs inside the caller's single mutation transaction —
// nothing is scheduled or deferred — which is what makes the use cases' check-then-save
// (one thread per exchange, one DM per pair) race-safe under Convex's serializable mutations.
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

  // The thread's companion message rows, ascending by sentAt (the index order).
  const messagesOf = (
    threadAggregateId: string,
  ): Promise<Doc<"threadMessages">[]> =>
    ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) =>
        q.eq("threadAggregateId", threadAggregateId),
      )
      .collect();

  const hydrate = async (row: Doc<"threads">): Promise<Thread> =>
    Thread.rehydrate(
      toDomain(
        row,
        await messagesOf(row.aggregateId),
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
      const row = {
        ...toThreadRow(thread),
        exchangeId:
          state.subject.kind === "exchange"
            ? await resolveExchangeId(state.subject.exchangeId)
            : undefined,
        // Denormalized inbox-ordering column: the newest message's instant, unset while empty.
        lastMessageAt:
          state.messages.length > 0
            ? Math.max(...state.messages.map((m) => m.sentAt.getTime()))
            : undefined,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("threads", row);

      // Messages are append-only companion rows: insert only the ones not yet persisted.
      // TODO(threshold): full-history scan per save — fine for v1 pair threads; if threads
      // approach thousands of messages, diff on sentAt >= stored max instead. Read models must
      // paginate by_thread_sent directly, never hydrate the aggregate.
      // markThreadRead is the hottest path and should become a receipt-only patch when the
      // threshold work happens.
      const storedIds = new Set(
        (await messagesOf(aggregateId)).map((m) => m.messageId),
      );
      for (const message of state.messages) {
        if (storedIds.has(message.id as string)) continue;
        await ctx.db.insert(
          "threadMessages",
          toMessageRow(aggregateId, message),
        );
      }

      // Read receipts are replaced wholesale (part of the thread row above); the participant
      // projection is synced exactly — insert missing, delete stale — so a re-save with an
      // unchanged participant set never duplicates rows.
      const wanted = new Set(
        state.participants.map((memberId) => memberId as string),
      );
      const participantRows = await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) => q.eq("threadAggregateId", aggregateId))
        .collect();
      for (const participantRow of participantRows) {
        if (wanted.has(participantRow.memberId as string)) {
          wanted.delete(participantRow.memberId as string);
        } else {
          await ctx.db.delete(participantRow._id);
        }
      }
      for (const memberId of wanted) {
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: aggregateId,
          memberId: memberId as Id<"users">,
        });
      }
    },
  };
};
