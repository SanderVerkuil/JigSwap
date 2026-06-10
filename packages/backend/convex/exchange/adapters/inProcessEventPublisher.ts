import type { DomainEventPublisher, ExchangeDomainEvent } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. It now durably
// records + schedules ALL exchange events (for async subscribers like Notifications) while KEEPING
// the one CRITICAL reaction inline: OwnershipTransferred must flip the transferred copy unavailable
// in the SAME transaction so a settled copy can never reappear on the market.
//
// WHY notifications moved out: trade_request/accepted/declined/cancelled/completed are no longer
// created inline here — they are produced by the async Notifications subscriber off these same
// events, decoupling Exchange from Notifications.
export const inProcessEventPublisher = (ctx: MutationCtx): DomainEventPublisher =>
  makeEventPublisher(ctx, "exchange", async (events) => {
    for (const event of events as readonly ExchangeDomainEvent[]) {
      // A settled copy leaves the market immediately — whether ownership moved (swap/sale) or only
      // possession did (lend). The async loan/transfer reactions then update owner/holder.
      if (
        event.name === "OwnershipTransferred" ||
        event.name === "PossessionTransferred"
      ) {
        await markCopyUnavailable(ctx, event.copyId as unknown as Id<"ownedPuzzles">);
      }
    }
  });

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
