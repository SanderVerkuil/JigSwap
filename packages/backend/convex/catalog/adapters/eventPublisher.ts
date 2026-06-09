import type { DomainEventPublisher } from "@jigswap/domain";

// Driven adapter for the DomainEventPublisher port. NO-OP for this slice: Catalog has no
// cross-context side effects yet (unlike Exchange, which notifies + flips availability).
// Durable/async fan-out (an events table + scheduler dispatch to Library/Social/Insights/
// Notifications) is a deliberate later enhancement, so events are recorded then dropped.
export const noopEventPublisher = (): DomainEventPublisher => ({
  async publish(): Promise<void> {
    // intentionally empty — persist + dispatch later.
  },
});
