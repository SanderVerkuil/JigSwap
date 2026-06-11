import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { ExchangeError } from "./errors";
import {
  DisputeRaised,
  ExchangeAccepted,
  ExchangeCancelled,
  ExchangeCompleted,
  ExchangeProposed,
  ExchangeRejected,
  OwnershipTransferred,
  PossessionTransferred,
} from "./events";
import { ExchangeKind } from "./exchange-kind";
import { ExchangeStatus } from "./exchange-status";
import { CopyId, ExchangeId, MemberId } from "./ids";
import {
  ExchangeTerms,
  ExchangeTermsInput,
  Money,
  validateTerms,
} from "./terms";

// Legal status moves. The aggregate's single source of truth for the state machine;
// any move not listed here is an IllegalTransition. (proposal §1.4)
const ALLOWED_TRANSITIONS: Readonly<
  Record<ExchangeStatus, readonly ExchangeStatus[]>
> = {
  proposed: ["accepted", "rejected", "cancelled"],
  accepted: ["completed", "cancelled", "disputed"],
  completed: ["disputed"], // a problem can surface after settlement
  rejected: [],
  cancelled: [],
  disputed: [],
};

// Input to propose(): the requested copy plus kind-tagged (still-unvalidated) terms.
export interface ProposeProps {
  readonly id: ExchangeId;
  readonly initiator: MemberId;
  readonly recipient: MemberId;
  readonly requestedCopyId: CopyId;
  readonly terms: ExchangeTermsInput;
  readonly now: Date;
}

// The persistable shape, kept deliberately close to the `exchanges` table columns so the
// 1b mapper is a trivial field-for-field translation (with kind <-> legacy-type renaming).
export interface ExchangeState {
  readonly id: ExchangeId;
  readonly initiatorId: MemberId;
  readonly recipientId: MemberId;
  readonly kind: ExchangeKind;
  readonly requestedCopyId: CopyId;
  readonly offeredCopyId?: CopyId; // swap only
  readonly price?: Money; // sale only
  readonly returnDate?: Date; // lend only
  readonly status: ExchangeStatus;
  readonly initiatorConfirmationTimestamp?: Date;
  readonly recipientConfirmationTimestamp?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Exchange {
  private events: DomainEvent[] = [];

  private constructor(private state: ExchangeState) {}

  get id(): ExchangeId {
    return this.state.id;
  }

  get status(): ExchangeStatus {
    return this.state.status;
  }

  get kind(): ExchangeKind {
    return this.state.kind;
  }

  // Create a brand-new proposal. Decides only from its own data: rejects self-exchange
  // and invalid kind-specific terms. Availability/dedup checks need repositories and live
  // in the application layer (1b), not here.
  static propose(props: ProposeProps): Result<Exchange, ExchangeError> {
    if (props.initiator === props.recipient) {
      return err(ExchangeError.selfExchange());
    }

    const terms = validateTerms(props.terms);
    if (terms.isErr) return err(terms.error);

    const state = Exchange.stateFromTerms(props, terms.value);
    const exchange = new Exchange(state);
    exchange.record(
      new ExchangeProposed(
        state.id,
        state.kind,
        state.initiatorId,
        state.recipientId,
        props.now,
      ),
    );
    return ok(exchange);
  }

  // Recipient agrees to the proposal.
  accept(by: MemberId, now: Date): Result<void, ExchangeError> {
    return this.guarded(
      "accepted",
      () => this.requireParty(by, "recipient", "accept"),
      now,
      () => {
        this.record(new ExchangeAccepted(this.id, now));
      },
    );
  }

  // Recipient declines the proposal.
  decline(by: MemberId, now: Date): Result<void, ExchangeError> {
    return this.guarded(
      "rejected",
      () => this.requireParty(by, "recipient", "decline"),
      now,
      () => {
        this.record(new ExchangeRejected(this.id, now));
      },
    );
  }

  // Initiator withdraws a proposed or accepted deal.
  cancel(by: MemberId, now: Date): Result<void, ExchangeError> {
    return this.guarded(
      "cancelled",
      () => this.requireParty(by, "initiator", "cancel"),
      now,
      () => {
        this.record(new ExchangeCancelled(this.id, now));
      },
    );
  }

  // Dual confirmation: record the acting party's timestamp; only settle to `completed`
  // once BOTH parties have confirmed. A lone confirmation does not transition status.
  confirmCompletion(by: MemberId, now: Date): Result<void, ExchangeError> {
    if (this.status !== "accepted") {
      return err(ExchangeError.illegalTransition(this.status, "completed"));
    }
    const party = this.partyOf(by);
    if (!party) return err(ExchangeError.wrongParty("confirm completion"));

    this.state = {
      ...this.state,
      ...(party === "initiator"
        ? { initiatorConfirmationTimestamp: now }
        : { recipientConfirmationTimestamp: now }),
      updatedAt: now,
    };

    if (!this.bothConfirmed()) return ok(undefined);
    return this.settle(now);
  }

  // Either party flags a problem (from accepted or after completion).
  raiseDispute(by: MemberId, now: Date): Result<void, ExchangeError> {
    if (!this.partyOf(by))
      return err(ExchangeError.wrongParty("raise a dispute"));
    return this.guarded(
      "disputed",
      () => ok(undefined),
      now,
      () => {
        this.record(new DisputeRaised(this.id, by, now));
      },
    );
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: ExchangeState): Exchange {
    return new Exchange(state);
  }

  toState(): ExchangeState {
    return this.state;
  }

  // --- internals ---

  // Shared guard for the simple transitions: authorise, check the move is legal, mutate
  // status, then let the caller record its event. Illegal moves return an error, never no-op.
  private guarded(
    to: ExchangeStatus,
    authorise: () => Result<void, ExchangeError>,
    now: Date,
    onTransition: () => void,
  ): Result<void, ExchangeError> {
    const auth = authorise();
    if (auth.isErr) return auth;
    const moved = this.transition(to, now);
    if (moved.isErr) return moved;
    onTransition();
    return ok(undefined);
  }

  // The ONLY place status changes. Rejects any move not in ALLOWED_TRANSITIONS.
  private transition(
    to: ExchangeStatus,
    now: Date,
  ): Result<void, ExchangeError> {
    if (!ALLOWED_TRANSITIONS[this.state.status].includes(to)) {
      return err(ExchangeError.illegalTransition(this.state.status, to));
    }
    this.state = { ...this.state, status: to, updatedAt: now };
    return ok(undefined);
  }

  // Settlement: complete, then hand over the requested copy. A swap/sale moves OWNERSHIP; a lend
  // moves only POSSESSION (the borrower holds it open-endedly, the owner keeps ownership). For a
  // swap the offered copy's ownership also moves to the recipient. (Cross-aggregate "a copy is
  // reserved by at most one active exchange" is an APPLICATION-layer rule, not enforced here.)
  private settle(now: Date): Result<void, ExchangeError> {
    const moved = this.transition("completed", now);
    if (moved.isErr) return moved;
    this.record(new ExchangeCompleted(this.id, now));
    if (this.state.kind === "lend") {
      this.record(
        new PossessionTransferred(
          this.id,
          this.state.requestedCopyId,
          this.state.initiatorId,
          this.state.returnDate,
          now,
        ),
      );
    } else {
      this.record(
        new OwnershipTransferred(
          this.id,
          this.state.requestedCopyId,
          this.state.initiatorId,
          now,
        ),
      );
    }
    if (this.state.kind === "swap" && this.state.offeredCopyId) {
      this.record(
        new OwnershipTransferred(
          this.id,
          this.state.offeredCopyId,
          this.state.recipientId,
          now,
        ),
      );
    }
    return ok(undefined);
  }

  private bothConfirmed(): boolean {
    return (
      this.state.initiatorConfirmationTimestamp !== undefined &&
      this.state.recipientConfirmationTimestamp !== undefined
    );
  }

  private partyOf(member: MemberId): "initiator" | "recipient" | null {
    if (member === this.state.initiatorId) return "initiator";
    if (member === this.state.recipientId) return "recipient";
    return null;
  }

  private requireParty(
    member: MemberId,
    expected: "initiator" | "recipient",
    action: string,
  ): Result<void, ExchangeError> {
    const required =
      expected === "initiator"
        ? this.state.initiatorId
        : this.state.recipientId;
    return member === required
      ? ok(undefined)
      : err(ExchangeError.wrongParty(action));
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }

  private static stateFromTerms(
    props: ProposeProps,
    terms: ExchangeTerms,
  ): ExchangeState {
    const base: Omit<
      ExchangeState,
      "kind" | "offeredCopyId" | "price" | "returnDate"
    > = {
      id: props.id,
      initiatorId: props.initiator,
      recipientId: props.recipient,
      requestedCopyId: props.requestedCopyId,
      status: "proposed",
      createdAt: props.now,
      updatedAt: props.now,
    };
    switch (terms.kind) {
      case "swap":
        return { ...base, kind: "swap", offeredCopyId: terms.offeredCopyId };
      case "sale":
        return { ...base, kind: "sale", price: terms.price };
      case "lend":
        return { ...base, kind: "lend", returnDate: terms.returnDate };
    }
  }
}
