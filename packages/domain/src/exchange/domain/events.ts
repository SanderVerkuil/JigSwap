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

// `cancelledBy` is the party who called the deal off (the initiator, or either party once it was
// accepted); the other party is the one to tell. Absent from events stored before it existed, which
// only an initiator could cause.
export class ExchangeCancelled implements DomainEvent {
  readonly name = "ExchangeCancelled";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly cancelledBy: MemberId,
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

// One per transferred copy (settlement invariant). Library reacts by handing the copy to
// `newOwner` and recording chain-of-custody. `expectedPreviousOwner` is the owner the deal was made
// with (the recipient for the requested copy, the recorded owner for a swap's offered copy): Library
// refuses the move once the copy belongs to anyone else. Undefined for an offered copy whose owner
// was never recorded, and absent from events stored before it existed: no check then.
export class OwnershipTransferred implements DomainEvent {
  readonly name = "OwnershipTransferred";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly copyId: CopyId,
    readonly newOwner: MemberId,
    readonly expectedPreviousOwner: MemberId | undefined,
    readonly occurredAt: Date,
  ) {}
}

// Settlement of a LEND: possession (not ownership) of the copy passes to the borrower. The owner
// is unchanged. Library opens an open-ended Loan in reaction, only while `lender` (the recipient
// the deal was made with) still owns the copy; expectedReturn is advisory. Events stored before
// `lender` existed lack it: no check then.
export class PossessionTransferred implements DomainEvent {
  readonly name = "PossessionTransferred";
  constructor(
    readonly exchangeId: ExchangeId,
    readonly copyId: CopyId,
    readonly borrower: MemberId,
    readonly expectedReturn: Date | undefined,
    readonly lender: MemberId,
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
  | PossessionTransferred
  | DisputeRaised;
