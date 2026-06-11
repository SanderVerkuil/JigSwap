import type { DomainEventPublisher } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. Library has no
// CRITICAL in-transaction reaction (no sync handlers); it durably records + schedules its events
// (CopyAcquired, CollectionCreated, ...) for the async subscribers. None map to a member-facing
// notification yet, but recording keeps the log complete + the seam ready for Social/Insights.
export const noopEventPublisher = (ctx: MutationCtx): DomainEventPublisher =>
  makeEventPublisher(ctx, "library");
