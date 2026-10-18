import {
  toMemberId,
  tradeRevealReasonFor,
  type ExchangeRevealTrigger,
} from "@jigswap/domain";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordTradeReveal } from "./tradeParty";

// The per-trade reveal subscriber: records the first time the OWNER acts on an exchange, which
// reveals the owner's limited trade card to the requester inside THAT exchange only
// (exchange/tradeParty). Which events count is the pure domain rule (tradeRevealReasonFor):
//   - ExchangeAccepted -> "accepted".
//   - MessagePosted in the exchange's own thread, authored by the owner -> "owner_replied".
//   - ExchangeProposed, DM threads, system (null-author) messages and the requester's own
//     messages record nothing. (The owner always sees the requester inside the trade — derived.)
//
// WHY an async subscriber and not inline in the exchange/conversation mutations: it keeps Exchange
// and Conversation free of the reveal rule. The reveal lags the owner's action by one scheduler
// tick, which FAILS SAFE (the owner stays hidden a moment longer). It runs before the Notifications
// subscriber in the same dispatch transaction, so a notification rendered afterwards sees the row.
//
// Never throws for ordinary data: a missing exchange row or an unrelated event is a no-op.
export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  const p = event.payload as Record<string, unknown>;
  switch (event.name) {
    case "ExchangeAccepted":
      return record(ctx, p.exchangeId, { kind: "ExchangeAccepted" }, event);
    case "MessagePosted": {
      const subject = p.subject as
        { kind?: string; exchangeId?: unknown } | undefined;
      if (subject?.kind !== "exchange") return; // DMs never reveal.
      const authorId = typeof p.authorId === "string" ? p.authorId : null;
      return record(
        ctx,
        subject.exchangeId,
        {
          kind: "ExchangeMessagePosted",
          authorId: authorId === null ? null : toMemberId(authorId),
        },
        event,
      );
    }
    default:
      return;
  }
};

const record = async (
  ctx: MutationCtx,
  exchangeAggregateId: unknown,
  trigger: ExchangeRevealTrigger,
  event: Doc<"domainEvents">,
): Promise<void> => {
  if (typeof exchangeAggregateId !== "string") return;
  const row = await ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", exchangeAggregateId),
    )
    .unique();
  if (!row) return;
  const reason = tradeRevealReasonFor(trigger, toMemberId(row.recipientId));
  if (reason === null) return;
  await recordTradeReveal(ctx, row._id, reason, event.occurredAt);
};
