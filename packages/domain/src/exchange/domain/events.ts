import { DomainEvent } from "../../shared-kernel";
import { ExchangeKind } from "./exchange-kind";
import { CopyId, ExchangeId, MemberId } from "./ids";

// All Exchange domain events implement DomainEvent (name + occurredAt). They are plain
// immutable records: the aggregate records them; an outbound publisher (1b) serialises
// and dispatches them to subscribers (Library, Reputation, Notifications, Insights).

export class ExchangeProposed implements DomainEvent {
  readonly name = "ExchangeProposed";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly kind: ExchangeKind,
    readonly initiator: MemberId,
    readonly recipient: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export class ExchangeAccepted implements DomainEvent {
  readonly name = "ExchangeAccepted";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly occurredAt: Date,
  ) {}
}

export class ExchangeRejected implements DomainEvent {
  readonly name = "ExchangeRejected";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly occurredAt: Date,
  ) {}
}

export class ExchangeCancelled implements DomainEvent {
  readonly name = "ExchangeCancelled";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly occurredAt: Date,
  ) {}
}

export class ExchangeCompleted implements DomainEvent {
  readonly name = "ExchangeCompleted";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly occurredAt: Date,
  ) {}
}

// One per transferred copy (settlement invariant). Library reacts by minting a new Copy
// for `newOwner` and recording chain-of-custody.
export class OwnershipTransferred implements DomainEvent {
  readonly name = "OwnershipTransferred";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly copyId: CopyId,
    readonly newOwner: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export class DisputeRaised implements DomainEvent {
  readonly name = "DisputeRaised";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly raisedBy: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export type ExchangeDomainEvent =
  | ExchangeProposed
  | ExchangeAccepted
  | ExchangeRejected
  | ExchangeCancelled
  | ExchangeCompleted
  | OwnershipTransferred
  | DisputeRaised;
