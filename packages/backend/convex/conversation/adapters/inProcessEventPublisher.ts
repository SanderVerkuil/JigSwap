import type { DomainEventPublisher } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. Conversation
// has no critical in-transaction reactions of its own; events (MessagePosted, ...) are durably
// recorded and dispatched async to the decoupled subscribers (e.g. Notifications).
export const inProcessEventPublisher = (
  ctx: MutationCtx,
): DomainEventPublisher => makeEventPublisher(ctx, "conversation");
