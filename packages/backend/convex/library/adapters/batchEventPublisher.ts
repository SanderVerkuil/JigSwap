import type { DomainEvent, DomainEventPublisher } from "@jigswap/domain";

// Decorates a publisher so every event it records carries `batchId` in its durable payload. Used
// by batch adds (acquireCopies): the activity feed folds CopyAcquired rows that share a batch id
// into ONE grouped entry, so a shelf backfill doesn't put one "acquired" entry per box in
// followers' feeds. The domain events are unchanged; the id is a transport-level fact about how
// they were produced.
export const batchEventPublisher = (
  inner: DomainEventPublisher,
  batchId: string,
): DomainEventPublisher => ({
  publish: (events: readonly DomainEvent[]) =>
    inner.publish(events.map((event) => ({ ...event, batchId }))),
});
