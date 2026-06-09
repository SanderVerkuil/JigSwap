import type { DomainEvent, DomainEventPublisher } from "@jigswap/domain";
import type { MutationCtx } from "../_generated/server";
import { recordAndSchedule } from "./recordAndSchedule";

// A context's synchronous, in-transaction reaction to its own events (e.g. exchange flips a copy
// unavailable on OwnershipTransferred; solving recomputes goals on CompletionRecorded). Runs
// BEFORE the durable record so the critical side effect commits atomically with the mutation.
export type SyncHandlers = (events: readonly DomainEvent[]) => Promise<void>;

// The single publisher every context wires into its use cases. It (1) runs the context's critical
// sync handlers in the same transaction, then (2) durably records EVERY event and schedules async
// dispatch to the decoupled subscribers (Notifications, future Insights/Social). `context` tags
// each row so the dispatcher/log can attribute provenance. WHY one shared factory: the record +
// schedule plumbing is identical across contexts; only the sync handlers differ.
export const makeEventPublisher = (
  ctx: MutationCtx,
  context: string,
  syncHandlers?: SyncHandlers,
): DomainEventPublisher => ({
  async publish(events: readonly DomainEvent[]): Promise<void> {
    if (syncHandlers) await syncHandlers(events);
    await recordAndSchedule(ctx, context, events);
  },
});
