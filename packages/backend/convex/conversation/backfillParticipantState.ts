import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { toLastMessage } from "./adapters/threadMapper";
import { unreadCountOf } from "./readModelHelpers";

// Threads per batch. Each thread costs one newest-message read, its participant rows (2 for pair
// threads, ≤ 50 for groups) and per row at most one capped unread scan plus one patch, so 100
// threads stay far below Convex's per-mutation document-read and write limits.
export const BACKFILL_PARTICIPANT_STATE_BATCH = 100;

type Counts = {
  threadsScanned: number;
  threadsPatched: number;
  participantsPatched: number;
};

// One-shot, idempotent backfill of the denormalized conversation state (spec R.1) onto rows
// written before it existed. Pages through `threads` and reschedules itself until the table is
// exhausted; each batch is its own transaction. Per thread it sets `lastMessage` from the newest
// message when absent; per participant row it sets `lastReadAt` from the legacy
// `threads.readReceipts` entry, `unreadCount` by the same capped scan the reads fall back to, and
// `lastActivityAt` = the thread's `lastMessageAt ?? createdAt` — each only when absent, so live
// writes are never overwritten and a re-run patches nothing. `dryRun` counts without writing.
export const backfillParticipantState = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        threadsScanned: v.number(),
        threadsPatched: v.number(),
        participantsPatched: v.number(),
      }),
    ),
  },
  handler: async (ctx, { cursor, dryRun, totals }): Promise<Counts> => {
    const page = await ctx.db.query("threads").paginate({
      numItems: BACKFILL_PARTICIPANT_STATE_BATCH,
      cursor: cursor ?? null,
    });

    const batch: Counts = {
      threadsScanned: 0,
      threadsPatched: 0,
      participantsPatched: 0,
    };
    for (const thread of page.page) {
      batch.threadsScanned++;
      if (thread.lastMessage === undefined) {
        const newest = await ctx.db
          .query("threadMessages")
          .withIndex("by_thread_sent", (q) =>
            q.eq("threadAggregateId", thread.aggregateId),
          )
          .order("desc")
          .first();
        if (newest) {
          if (!dryRun) {
            await ctx.db.patch(thread._id, {
              lastMessage: toLastMessage(newest),
            });
          }
          batch.threadsPatched++;
        }
      }

      const participantRows = await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) =>
          q.eq("threadAggregateId", thread.aggregateId),
        )
        .collect();
      for (const row of participantRows) {
        const patch: Partial<Doc<"threadParticipants">> = {};
        if (row.lastReadAt === undefined) {
          const legacy = thread.readReceipts?.find(
            (receipt) => receipt.memberId === row.memberId,
          );
          if (legacy) patch.lastReadAt = legacy.lastReadAt;
        }
        if (row.unreadCount === undefined) {
          patch.unreadCount = await unreadCountOf(
            ctx,
            thread,
            row.memberId,
            row,
          );
        }
        if (row.lastActivityAt === undefined) {
          patch.lastActivityAt = thread.lastMessageAt ?? thread.createdAt;
        }
        if (Object.keys(patch).length === 0) continue;
        if (!dryRun) await ctx.db.patch(row._id, patch);
        batch.participantsPatched++;
      }
    }

    const runTotals: Counts = {
      threadsScanned: (totals?.threadsScanned ?? 0) + batch.threadsScanned,
      threadsPatched: (totals?.threadsPatched ?? 0) + batch.threadsPatched,
      participantsPatched:
        (totals?.participantsPatched ?? 0) + batch.participantsPatched,
    };
    console.log(
      `conversation/backfillParticipantState${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.conversation.backfillParticipantState.backfillParticipantState,
        {
          cursor: page.continueCursor,
          totals: runTotals,
          ...(dryRun ? { dryRun } : {}),
        },
      );
    }
    return batch;
  },
});
