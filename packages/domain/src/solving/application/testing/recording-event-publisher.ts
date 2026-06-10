import { DomainEvent, DomainEventPublisher } from "../../../shared-kernel";

// Captures every published event so tests can assert on the published language (not internals).
export class RecordingEventPublisher implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];
  // One entry per publish() call, so tests can distinguish "never published" from "published []".
  readonly batches: (readonly DomainEvent[])[] = [];

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.batches.push(events);
    this.published.push(...events);
  }

  names(): string[] {
    return this.published.map((e) => e.name);
  }

  countOf(name: string): number {
    return this.published.filter((e) => e.name === name).length;
  }
}
