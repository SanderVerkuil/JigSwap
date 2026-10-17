import {
  exchangeIdentityReveals,
  ownerActedInHistory,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { grantIdentityReveal, hasIdentityReveal } from "./identityReveals";

// Exchanges per batch. Each exchange costs two grant point reads (+ up to two inserts) and, only
// when its status alone doesn't prove the owner acted, a BOUNDED read of that exchange's thread and
// legacy chat (MESSAGE_SCAN_CAP rows each). Worst case ~25 * (2 * 200 + 4) ≈ 10k documents per
// batch, well inside Convex's per-transaction read limits.
export const BACKFILL_IDENTITY_REVEALS_BATCH = 25;

// Oldest messages read per thread / legacy chat when looking for evidence. An owner who acted did so
// early in practice (the reply or acceptance comes first); evidence past the cap is not seen, which
// FAILS CLOSED (the owner stays anonymous) rather than blowing the transaction.
export const MESSAGE_SCAN_CAP = 200;

// The lifecycle system message conversation/subscriber posts on ExchangeAccepted.
const ACCEPTED_LIFECYCLE_BODY = "Exchange accepted";

type Counts = { scanned: number; created: number; existing: number };

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
      (m) => m.kind === "system" && m.body === ACCEPTED_LIFECYCLE_BODY,
    ),
  };
};

// One-shot, idempotent backfill of trade identity reveals for exchanges created before the
// identityReveals subscriber existed. Pages through `exchanges`, rescheduling itself until the table
// is exhausted; each batch is its own transaction. Per exchange the domain rule decides the grants:
// owner -> requester always; requester -> owner iff the owner acted (ownerActedInHistory — a
// post-accept status, or positive evidence; otherwise FAIL CLOSED, the owner stays anonymous).
// Pairs that already hold a grant are skipped, so re-running creates nothing new. `dryRun` walks
// every page and counts without writing (its `created` may over-count a pair that repeats across
// exchanges, since nothing is inserted to dedupe against).
export const backfillIdentityReveals = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(
      v.object({
        scanned: v.number(),
        created: v.number(),
        existing: v.number(),
      }),
    ),
  },
  handler: async (ctx, { cursor, dryRun, totals }): Promise<Counts> => {
    const page = await ctx.db.query("exchanges").paginate({
      numItems: BACKFILL_IDENTITY_REVEALS_BATCH,
      cursor: cursor ?? null,
    });

    const now = Date.now();
    const batch: Counts = { scanned: 0, created: 0, existing: 0 };
    for (const exchange of page.page) {
      batch.scanned++;
      const recipient = toMemberId(exchange.recipientId);
      const statusOnly = ownerActedInHistory({
        status: exchange.status,
        ownerAuthoredMessage: false,
        acceptedLifecycleMessage: false,
      });
      const ownerActed =
        statusOnly || ownerActedInHistory(await historyOf(ctx, exchange));
      const reveals = exchangeIdentityReveals({
        initiator: toMemberId(exchange.initiatorId),
        recipient,
        ownerActed,
      });
      for (const reveal of reveals) {
        const viewerId = reveal.viewer as unknown as Id<"users">;
        const targetId = reveal.target as unknown as Id<"users">;
        if (await hasIdentityReveal(ctx, viewerId, targetId)) {
          batch.existing++;
          continue;
        }
        if (!dryRun) {
          await grantIdentityReveal(ctx, {
            viewerId,
            targetId,
            exchangeId: exchange._id,
            reason:
              reveal.target === recipient
                ? "exchange_owner_acted"
                : "exchange_requested",
            createdAt: now,
          });
        }
        batch.created++;
      }
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      created: (totals?.created ?? 0) + batch.created,
      existing: (totals?.existing ?? 0) + batch.existing,
    };
    console.log(
      `social/backfillIdentityReveals${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.social.backfillIdentityReveals.backfillIdentityReveals,
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
