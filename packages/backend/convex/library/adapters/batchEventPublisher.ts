import type { DomainEvent, DomainEventPublisher } from "@jigswap/domain";

// Decorates a publisher so every event it records carries `bulk: true` in its durable payload.
// Used by batch adds (acquireCopies): the activity feed skips bulk CopyAcquired rows, so a shelf
// backfill doesn't put one "acquired" entry per box in followers' feeds. The domain events are
// unchanged; the tag is a transport-level fact about how they were produced.
export const bulkEventPublisher = (
  inner: DomainEventPublisher,
): DomainEventPublisher => ({
  publish: (events: readonly DomainEvent[]) =>
    inner.publish(events.map((event) => ({ ...event, bulk: true }))),
});
