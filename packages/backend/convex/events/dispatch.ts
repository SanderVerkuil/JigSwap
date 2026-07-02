import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { handleDomainEvent as handleConversationEvent } from "../conversation/subscriber";
import { handleDomainEvent as handleCustodyEvent } from "../custody/subscriber";
import { handleDomainEvent as handleOpenLoanEvent } from "../library/openLoanOnSettlement";
import { handleDomainEvent as handleLibraryTransferEvent } from "../library/transferOnSettlement";
import { handleDomainEvent as handleNotificationEvent } from "../notifications/subscriber";

// The central async dispatcher. Scheduled once per recorded domain event; it loads the row, routes
// it to every registered ASYNC subscriber (Notifications, Conversation, Custody, the Library
// transfer + open-loan reactions), then stamps processedAt.
//
// Resilience: subscriber work runs in THIS mutation's transaction. If a subscriber throws, the
// whole mutation rolls back (processedAt stays unset) and Convex retries the scheduled function —
// so an event is never silently lost. We only stamp processedAt after all subscribers succeed.
// An already-processed event is a no-op (idempotent against duplicate scheduling/retries).
export const dispatch = internalMutation({
  args: { eventId: v.id("domainEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return; // event row gone (e.g. test teardown); nothing to do.
    if (event.processedAt !== undefined) return; // already handled.

    // Fan out to every async subscriber. A throw in any propagates so the scheduler retries the
    // whole mutation (see module comment); both run in this transaction.
    await handleNotificationEvent(ctx, event);
    // Conversation opens the exchange thread + appends the lifecycle system message.
    await handleConversationEvent(ctx, event);
    // Custody records the pre-transfer owner, so it MUST run before the library transfer reassigns it.
    await handleCustodyEvent(ctx, event);
    await handleLibraryTransferEvent(ctx, event);
    // A settled lend opens a loan (reacts to PossessionTransferred, not OwnershipTransferred).
    await handleOpenLoanEvent(ctx, event);

    await ctx.db.patch(eventId, { processedAt: Date.now() });
  },
});
