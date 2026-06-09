import type { DomainEventPublisher } from "@jigswap/domain";

// Driven adapter for the DomainEventPublisher port. NO-OP for this slice: the Library context
// has no cross-context side effects to dispatch yet. Its events (CopyAcquired, CopyMadeAvailable,
// CollectionCreated, ...) are consumed by Social/Insights/Notifications in later phases; until
// then there is nothing to react to in-process, so events are recorded by the aggregates and
// dropped here. Durable/async fan-out (an events table + scheduler dispatch) is a deliberate
// later enhancement, mirroring the Catalog no-op publisher.
export const noopEventPublisher = (): DomainEventPublisher => ({
  async publish(): Promise<void> {
    // intentionally empty — persist + dispatch later.
  },
});
