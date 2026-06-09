import { DomainEvent, DomainEventPublisher } from "../../../shared-kernel";

// Captures every published event so tests can assert on the published language (not internals).
export class RecordingEventPublisher implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
  }

  names(): string[] {
    return this.published.map((e) => e.name);
  }
}
