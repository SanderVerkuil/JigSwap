import { DomainEvent } from "./domain-event";

// Outbound port: how a use case hands recorded domain events to the world. The concrete
// publisher (Convex scheduler fan-out) is an adapter; only the contract lives in the domain.
export interface DomainEventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
