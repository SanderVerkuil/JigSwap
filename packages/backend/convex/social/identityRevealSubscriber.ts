import {
  exchangeIdentityReveals,
  ownerActedOnTrigger,
  toMemberId,
  type ExchangeRevealTrigger,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { grantIdentityReveal } from "./identityReveals";

// The trade identity-reveal subscriber: turns Exchange + Conversation events into the append-only
// `identityReveals` grants the privacy chokepoint (projectMemberIdentity) reads. The decision of
// WHICH grants an event warrants is the pure domain rule (exchangeIdentityReveals /
// ownerActedOnTrigger); this module only loads the exchange row and writes idempotently.
//   - ExchangeProposed       -> owner sees requester.
//   - ExchangeAccepted       -> requester sees owner (plus the owner->requester grant, idempotent).
//   - MessagePosted (exchange thread, owner-authored) -> requester sees owner. DM threads,
//     system (null-author) messages and the requester's own messages grant nothing new.
//
// WHY an async subscriber and not inline in the exchange/conversation mutations: it keeps Exchange
// and Conversation decoupled from Social's privacy model. The reveal lags the triggering mutation by
// one scheduler tick, which FAILS SAFE — the counterparty simply stays anonymous a moment longer.
// It runs before the Notifications subscriber in the same dispatch transaction, so a notification
// rendered after the dispatch already sees the grant.
//
// Never throws for ordinary data: a missing exchange row or an unrelated event is a no-op.
export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  const p = event.payload as Record<string, unknown>;
  switch (event.name) {
    case "ExchangeProposed":
      return grantFor(ctx, p.exchangeId, { kind: "ExchangeProposed" }, event);
    case "ExchangeAccepted":
      return grantFor(ctx, p.exchangeId, { kind: "ExchangeAccepted" }, event);
    case "MessagePosted": {
      const subject = p.subject as
        { kind?: string; exchangeId?: unknown } | undefined;
      if (subject?.kind !== "exchange") return; // DMs never reveal.
      const authorId = typeof p.authorId === "string" ? p.authorId : null;
      return grantFor(
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

const grantFor = async (
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

  const recipient = toMemberId(row.recipientId);
  const reveals = exchangeIdentityReveals({
    initiator: toMemberId(row.initiatorId),
    recipient,
    ownerActed: ownerActedOnTrigger(trigger, recipient),
  });
  for (const reveal of reveals) {
    await grantIdentityReveal(ctx, {
      viewerId: reveal.viewer as unknown as Id<"users">,
      targetId: reveal.target as unknown as Id<"users">,
      exchangeId: row._id,
      reason:
        reveal.target === recipient
          ? "exchange_owner_acted"
          : "exchange_requested",
      createdAt: event.occurredAt,
    });
  }
};
