import {
  makeOpenThread,
  makePostSystemMessage,
  toExchangeId,
  toMemberId,
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
// append their system message. The bodies are fixed English strings — stable identifiers the UI
// may map to i18n later.
//
// WHY here and not inline in Exchange: Conversation is a decoupled subscriber — Exchange only
// publishes its domain events and knows nothing about threads.
const LIFECYCLE_BODIES: Partial<Record<string, string>> = {
  ExchangeProposed: "Exchange proposed",
  ExchangeAccepted: "Exchange accepted",
  ExchangeRejected: "Exchange rejected",
  ExchangeCancelled: "Exchange cancelled",
  ExchangeCompleted: "Exchange completed",
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
  const body = LIFECYCLE_BODIES[event.name];
  if (body === undefined) return;

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
  const posted = await post({ threadId: opened.value, body });
  // A failure here (e.g. corrupt thread) must THROW so the dispatcher's transaction rolls back
  // and the scheduler retries — the event must not be stamped processed with the message lost.
  if (posted.isErr) throw toConvexError(posted.error);
};
