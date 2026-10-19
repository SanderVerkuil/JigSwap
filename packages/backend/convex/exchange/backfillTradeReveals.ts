import { tradeRevealReasonFromHistory } from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { hasTradeReveal, recordTradeReveal } from "./tradeParty";

// Exchanges per batch. Each exchange costs one tradeReveals point read (+ at most one insert) and, only
// when its status alone doesn't prove the owner acted, a BOUNDED read of that exchange's thread and
// legacy chat (MESSAGE_SCAN_CAP rows each). Worst case ~25 * (2 * 200 + 3) ≈ 10k documents per
// batch, well inside Convex's per-transaction read limits.
export const BACKFILL_TRADE_REVEALS_BATCH = 25;

// Oldest messages read per thread / legacy chat when looking for evidence. An owner who acted did so
// early in practice (the reply or acceptance comes first); evidence past the cap is not seen, which
// FAILS CLOSED (the owner stays hidden) rather than blowing the transaction.
export const MESSAGE_SCAN_CAP = 200;

// The lifecycle system message conversation/subscriber posted on ExchangeAccepted before rows
// carried a structured `tradeEvent`.
const ACCEPTED_LIFECYCLE_BODY = "Exchange accepted";

type Counts = {
  scanned: number;
  created: number;
  existing: number;
  notActed: number;
};

// Positive evidence that the owner acted on a pre-existing exchange whose status is ambiguous
// (proposed / rejected / cancelled): an owner-authored message in the exchange's own thread, the
// "Exchange accepted" lifecycle message there, or an owner-sent, non-system row in the legacy
// `messages` chat (system rows don't count, matching the live rule).
const historyOf = async (ctx: MutationCtx, exchange: Doc<"exchanges">) => {
  const owner = exchange.recipientId;
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_exchange", (q) => q.eq("exchangeId", exchange._id))
    .first();
  const threadMessages = thread
    ? await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) =>
          q.eq("threadAggregateId", thread.aggregateId),
        )
        .take(MESSAGE_SCAN_CAP)
    : [];
  const legacyMessages = await ctx.db
    .query("messages")
    .withIndex("by_exchange", (q) => q.eq("exchangeId", exchange._id))
    .take(MESSAGE_SCAN_CAP);
  return {
    status: exchange.status,
    ownerAuthoredMessage:
      threadMessages.some((m) => m.authorId === owner) ||
      legacyMessages.some(
        (m) => m.senderId === owner && m.messageType !== "system",
      ),
    acceptedLifecycleMessage: threadMessages.some(
      (m) =>
        m.kind === "system" &&
        (m.tradeEvent?.kind === "accepted" ||
          m.body === ACCEPTED_LIFECYCLE_BODY),
    ),
  };
};

// One-shot, idempotent backfill of per-trade owner reveals (`tradeReveals`) for exchanges created
// before exchange/tradeRevealSubscriber existed. Pages through `exchanges`, rescheduling itself
// until the table is exhausted; each batch is its own transaction. Per exchange the domain rule
// (tradeRevealReasonFromHistory) decides: a post-accept status or the "Exchange accepted" lifecycle
// message -> "accepted"; an owner-authored message -> "owner_replied"; otherwise nothing (FAIL
// CLOSED, the owner stays hidden). The owner seeing the requester is derived and needs no row.
// Exchanges that already hold a row are skipped, so re-running creates nothing new. `dryRun` walks
// every page and counts without writing.
export const backfillTradeReveals = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        created: v.number(),
        existing: v.number(),
        notActed: v.number(),
      }),
    ),
  },
  handler: async (ctx, { cursor, dryRun, totals }): Promise<Counts> => {
    const page = await ctx.db.query("exchanges").paginate({
      numItems: BACKFILL_TRADE_REVEALS_BATCH,
      cursor: cursor ?? null,
    });

    const now = Date.now();
    const batch: Counts = { scanned: 0, created: 0, existing: 0, notActed: 0 };
    for (const exchange of page.page) {
      batch.scanned++;
      if (await hasTradeReveal(ctx, exchange._id)) {
        batch.existing++;
        continue;
      }
      // A post-accept status decides alone; only read the thread when it doesn't.
      const reason =
        tradeRevealReasonFromHistory({
          status: exchange.status,
          ownerAuthoredMessage: false,
          acceptedLifecycleMessage: false,
        }) ?? tradeRevealReasonFromHistory(await historyOf(ctx, exchange));
      if (reason === null) {
        batch.notActed++;
        continue;
      }
      if (!dryRun) await recordTradeReveal(ctx, exchange._id, reason, now);
      batch.created++;
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      created: (totals?.created ?? 0) + batch.created,
      existing: (totals?.existing ?? 0) + batch.existing,
      notActed: (totals?.notActed ?? 0) + batch.notActed,
    };
    console.log(
      `exchange/backfillTradeReveals${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.exchange.backfillTradeReveals.backfillTradeReveals,
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
