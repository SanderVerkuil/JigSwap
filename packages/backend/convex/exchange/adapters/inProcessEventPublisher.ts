import type { DomainEvent, DomainEventPublisher, ExchangeDomainEvent } from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. Handlers
// run SYNCHRONOUSLY inside the same Convex transaction, preserving atomicity. WHY in-process:
// durable/async fan-out (an events table + scheduler dispatch) is a deliberate later enhancement.
export const inProcessEventPublisher = (ctx: MutationCtx): DomainEventPublisher => ({
  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events as readonly ExchangeDomainEvent[]) {
      switch (event.name) {
        case "ExchangeProposed":
        case "ExchangeAccepted":
        case "ExchangeRejected":
        case "ExchangeCancelled":
        case "ExchangeCompleted":
          await notifyOnExchangeEvent(ctx, event);
          break;
        case "OwnershipTransferred":
          await markCopyUnavailable(ctx, event.copyId as unknown as Id<"ownedPuzzles">);
          break;
        // DisputeRaised has no legacy notification mapping; intentionally no-op for this slice.
        default:
          break;
      }
    }
  },
});

// Resolve the persisted row for an aggregateId so handlers can address the real parties.
const loadRow = async (
  ctx: MutationCtx,
  aggregateId: string,
): Promise<Doc<"exchanges"> | null> =>
  ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
    .unique();

// Notifications handler: reuses the legacy `type` literals + wording from exchanges.ts.
const notifyOnExchangeEvent = async (
  ctx: MutationCtx,
  event: Extract<
    ExchangeDomainEvent,
    {
      name:
        | "ExchangeProposed"
        | "ExchangeAccepted"
        | "ExchangeRejected"
        | "ExchangeCancelled"
        | "ExchangeCompleted";
    }
  >,
): Promise<void> => {
  const row = await loadRow(ctx, event.exchangeId as string);
  if (!row) return;
  const relatedId = row._id as string;

  switch (event.name) {
    case "ExchangeProposed":
      await insertNotification(ctx, row.recipientId, "trade_request", "New Exchange Request", "Someone wants to trade for one of your puzzles", relatedId);
      break;
    case "ExchangeAccepted":
      await insertNotification(ctx, row.initiatorId, "trade_accepted", "Exchange Accepted", "Your trade request has been accepted!", relatedId);
      break;
    case "ExchangeRejected":
      await insertNotification(ctx, row.initiatorId, "trade_declined", "Exchange Declined", "Your trade request has been declined", relatedId);
      break;
    case "ExchangeCancelled":
      await insertNotification(ctx, row.recipientId, "trade_cancelled", "Exchange Cancelled", "Exchange request has been cancelled", relatedId);
      break;
    case "ExchangeCompleted":
      // The event carries no actor; notify both parties so each gets "the other party" signal.
      await insertNotification(ctx, row.initiatorId, "trade_completed", "Exchange Completed", "Exchange has been marked as completed", relatedId);
      await insertNotification(ctx, row.recipientId, "trade_completed", "Exchange Completed", "Exchange has been marked as completed", relatedId);
      break;
  }
};

type NotificationType = Doc<"notifications">["type"];

const insertNotification = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  type: NotificationType,
  title: string,
  message: string,
  relatedId: string,
): Promise<void> => {
  await ctx.db.insert("notifications", {
    userId,
    type,
    title,
    message,
    relatedId,
    isRead: false,
    createdAt: Date.now(),
  });
};

// Availability handler: mirrors today's "mark unavailable on completion" — a transferred copy
// leaves the market. Emitted per transferred copy (requested->initiator, swap offered->recipient).
const markCopyUnavailable = async (
  ctx: MutationCtx,
  copyId: Id<"ownedPuzzles">,
): Promise<void> => {
  const copy = await ctx.db.get(copyId);
  if (!copy) return;
  await ctx.db.patch(copyId, {
    availability: { forTrade: false, forSale: false, forLend: false },
  });
};
