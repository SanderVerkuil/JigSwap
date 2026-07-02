import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";

// One-off, idempotent backfill: legacy exchange chat (`messages` rows) becomes Conversation
// threads. Run manually (npx convex run conversation/backfill:run); not part of the feature path.
// The `messages` table itself is dropped in a follow-up once this has run in production.
//
// Shape: walk the legacy `messages` table one page per invocation (cursor/limit args, returned
// continuation) so each mutation transaction stays bounded; every exchange touched by the page is
// processed in FULL (its whole legacy history), which keeps a group split across pages correct —
// re-processing is a no-op because each copied message carries the derived id
// `legacy-<messages._id>` and is skipped when already present (`by_message_id`). That same check
// merges cleanly into a thread the subscriber already opened post-deploy (proposal-window
// overlap). Read receipts for both parties are raised (never lowered) to the newest legacy
// message's instant so the backfill creates no stale unread wall, and legacy message_received
// notifications whose relatedId is the exchange _id are remapped to the thread's aggregateId
// (the new UI deep-links relatedId as a threadId).

const legacyMessageId = (id: Id<"messages">): string => `legacy-${id}`;

// Ensure the exchange's thread row (+ participant projection) exists, returning it. A created
// thread mirrors what the repository would persist: fresh uuid aggregateId, exchange subject,
// the two parties, sorted participantsKey, createdAt = the first legacy message's instant.
const ensureThread = async (
  ctx: MutationCtx,
  exchange: Doc<"exchanges">,
  firstMessageAt: number,
): Promise<{ thread: Doc<"threads">; created: boolean }> => {
  const existing = await ctx.db
    .query("threads")
    .withIndex("by_exchange", (q) => q.eq("exchangeId", exchange._id))
    .unique();
  if (existing) return { thread: existing, created: false };

  const aggregateId = crypto.randomUUID();
  const participants = [exchange.initiatorId, exchange.recipientId];
  const threadDocId = await ctx.db.insert("threads", {
    aggregateId,
    subjectKind: "exchange",
    exchangeId: exchange._id,
    participants,
    participantsKey: participants
      .map((memberId) => memberId as string)
      .sort()
      .join("|"),
    readReceipts: [],
    lastMessageAt: undefined,
    createdAt: firstMessageAt,
  });
  for (const memberId of participants) {
    await ctx.db.insert("threadParticipants", {
      threadAggregateId: aggregateId,
      memberId,
    });
  }
  const thread = await ctx.db.get(threadDocId);
  if (!thread) throw new Error("just-inserted thread row missing");
  return { thread, created: true };
};

export const run = internalMutation({
  args: {
    // Continuation from a previous invocation's `continueCursor`; absent = start from the top.
    cursor: v.optional(v.string()),
    // Legacy messages scanned per invocation (each exchange in the page is processed in full).
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("messages").paginate({
      cursor: args.cursor ?? null,
      numItems: args.limit ?? 200,
    });

    const exchangeIds = [
      ...new Set(page.page.map((message) => message.exchangeId)),
    ];
    let threadsCreated = 0;
    let messagesCopied = 0;
    let notificationsRemapped = 0;
    let exchangesSkipped = 0;

    for (const exchangeId of exchangeIds) {
      // An exchange row deleted out from under its messages leaves no way to name the thread's
      // participants (and the inbox would drop the thread anyway) — skip it.
      const exchange = await ctx.db.get(exchangeId);
      if (!exchange) {
        exchangesSkipped += 1;
        continue;
      }

      const legacy = await ctx.db
        .query("messages")
        .withIndex("by_exchange", (q) => q.eq("exchangeId", exchangeId))
        .collect();
      legacy.sort(
        (a, b) =>
          a.createdAt - b.createdAt || a._creationTime - b._creationTime,
      );
      const firstAt = legacy[0].createdAt;
      const newestAt = legacy[legacy.length - 1].createdAt;

      const { thread, created } = await ensureThread(ctx, exchange, firstAt);
      if (created) threadsCreated += 1;

      // Copy each legacy message not yet present (derived id = natural idempotency key).
      for (const message of legacy) {
        const messageId = legacyMessageId(message._id);
        const already = await ctx.db
          .query("threadMessages")
          .withIndex("by_message_id", (q) => q.eq("messageId", messageId))
          .unique();
        if (already) continue;
        await ctx.db.insert("threadMessages", {
          threadAggregateId: thread.aggregateId,
          messageId,
          // system messages carry no author (legacy stored a sender even for them).
          authorId:
            message.messageType === "system" ? undefined : message.senderId,
          kind: message.messageType,
          body: message.content,
          sentAt: message.createdAt,
        });
        messagesCopied += 1;
      }

      // Raise (never lower) both parties' receipts to the newest legacy instant, and the
      // denormalized lastMessageAt likewise — a newer live message must stay newest/unread.
      const receipts = thread.readReceipts.map((receipt) => ({ ...receipt }));
      let receiptsChanged = false;
      for (const memberId of [exchange.initiatorId, exchange.recipientId]) {
        const receipt = receipts.find((r) => r.memberId === memberId);
        if (!receipt) {
          receipts.push({ memberId, lastReadAt: newestAt });
          receiptsChanged = true;
        } else if (receipt.lastReadAt < newestAt) {
          receipt.lastReadAt = newestAt;
          receiptsChanged = true;
        }
      }
      const lastMessageAt = Math.max(thread.lastMessageAt ?? 0, newestAt);
      const patch: Partial<Doc<"threads">> = {};
      if (receiptsChanged) patch.readReceipts = receipts;
      if (lastMessageAt !== thread.lastMessageAt)
        patch.lastMessageAt = lastMessageAt;
      if (Object.keys(patch).length > 0) await ctx.db.patch(thread._id, patch);

      // Remap legacy message_received notifications (relatedId = exchange _id, written by the
      // old sendExchangeMessage) to the thread aggregateId the new UI deep-links. Rows already
      // carrying a thread id never equal the exchange _id, so they are left untouched — and the
      // remap makes itself a no-op on re-runs.
      const stale = await ctx.db
        .query("notifications")
        .withIndex("by_type", (q) => q.eq("type", "message_received"))
        .filter((q) => q.eq(q.field("relatedId"), exchangeId as string))
        .collect();
      for (const notification of stale) {
        await ctx.db.patch(notification._id, {
          relatedId: thread.aggregateId,
        });
        notificationsRemapped += 1;
      }
    }

    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      exchangesProcessed: exchangeIds.length - exchangesSkipped,
      exchangesSkipped,
      threadsCreated,
      messagesCopied,
      notificationsRemapped,
    };
  },
});
