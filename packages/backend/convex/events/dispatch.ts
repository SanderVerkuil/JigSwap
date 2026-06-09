import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { handleDomainEvent } from "../notifications/subscriber";

// The central async dispatcher. Scheduled once per recorded domain event; it loads the row, routes
// it to every registered ASYNC subscriber (currently only Notifications), then stamps processedAt.
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

    // Notifications is the only async subscriber today; add further routing here as contexts gain
    // subscribers. A throw here propagates so the scheduler retries (see module comment).
    await handleDomainEvent(ctx, event);

    await ctx.db.patch(eventId, { processedAt: Date.now() });
  },
});
