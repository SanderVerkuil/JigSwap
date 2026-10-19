import {
  makeOpenThread,
  makePostSystemMessage,
  toExchangeId,
  toMemberId,
  TRADE_EVENT_BODY,
  type TradeEventKind,
} from "@jigswap/domain";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator, threadIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// The Conversation subscriber: folds Exchange lifecycle events into the exchange's thread. On
// ExchangeProposed it opens the thread between the two parties (idempotent — openThread lands on
// the existing thread if one exists) and posts the "Exchange proposed" system message; the other
// lifecycle events resolve the same thread the same way (opening it if somehow missing) and
// append their system message. Each row stores its structured `tradeEvent` (the client renders it
// in the reader's language) and a render-neutral body token (TRADE_EVENT_BODY).
//
// WHY here and not inline in Exchange: Conversation is a decoupled subscriber — Exchange only
// publishes its domain events and knows nothing about threads.
//
// Message idempotency relies on Exchange emitting each lifecycle transition exactly once; the
// dispatcher's processedAt guard covers re-scheduling of the same event row.
export const LIFECYCLE_TRADE_EVENTS: Partial<Record<string, TradeEventKind>> = {
  ExchangeProposed: "proposed",
  ExchangeAccepted: "accepted",
  ExchangeRejected: "rejected",
  ExchangeCancelled: "cancelled",
  ExchangeCompleted: "completed",
};

// Resolve the persisted exchange row from its ExchangeId aggregateId so we can address the real
// parties as the thread's participants.
const loadExchange = (
  ctx: MutationCtx,
  aggregateId: string,
): Promise<Doc<"exchanges"> | null> =>
  ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();

export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  if (!Object.prototype.hasOwnProperty.call(LIFECYCLE_TRADE_EVENTS, event.name))
    return;
  const kind = LIFECYCLE_TRADE_EVENTS[event.name] as TradeEventKind;

  const p = event.payload as Record<string, unknown>;
  const row = await loadExchange(ctx, p.exchangeId as string);
  if (!row) return;

  const threads = convexThreadRepository(ctx);

  const openThread = makeOpenThread({ threads, threadIds: threadIdGenerator });
  const opened = await openThread({
    exchangeId: toExchangeId(p.exchangeId as string),
    participants: [
      toMemberId(row.initiatorId as string),
      toMemberId(row.recipientId as string),
    ],
  });
  if (opened.isErr) throw toConvexError(opened.error); // unreachable (Result<_, never>)

  const post = makePostSystemMessage({
    threads,
    messageIds: messageIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });
  const posted = await post({
    threadId: opened.value,
    body: TRADE_EVENT_BODY[kind],
    tradeEvent: { kind },
  });
  // A failure here (e.g. corrupt thread) must THROW so this subscriber's sub-transaction rolls
  // back and the dispatcher records + alerts on it (events/dispatch) — the event must not be
  // stamped processed with the message lost. Not auto-retried: a re-run appends a message.
  if (posted.isErr) throw toConvexError(posted.error);
};
