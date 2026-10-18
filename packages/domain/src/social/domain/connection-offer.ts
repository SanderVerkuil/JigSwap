import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";
import { ConnectionOffered } from "./events";
import { ConnectionOfferId, MemberId } from "./ids";

export type ConnectionOfferStatus =
  "pending" | "accepted" | "declined" | "expired";

// Where the offer came from: a member's network invite link, a household invite link, or an email
// invitation (to someone who signed up through it, or who already had an account).
export type ConnectionOfferSource =
  "inviteLink" | "householdLink" | "emailInvite";

// An unanswered offer lapses 30 days after it was made.
export const CONNECTION_OFFER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ConnectionOfferState {
  readonly id: ConnectionOfferId;
  readonly fromId: MemberId;
  readonly toId: MemberId;
  readonly source: ConnectionOfferSource;
  readonly status: ConnectionOfferStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt?: Date;
}

// ConnectionOffer: the person who invited a member offers to follow each other, and the member
// confirms first. Lifecycle is pending → accepted | declined | expired. Only the recipient (toId)
// answers; the application layer creates the follow edges on accept. Only the offer itself is
// recorded as an event: an accept surfaces through the follow events, and a decline is silent.
// At most one pending offer per ordered pair is an application-layer rule (needs the repository).
export class ConnectionOffer {
  private events: DomainEvent[] = [];

  private constructor(private state: ConnectionOfferState) {}

  get id(): ConnectionOfferId {
    return this.state.id;
  }

  get fromId(): MemberId {
    return this.state.fromId;
  }

  get toId(): MemberId {
    return this.state.toId;
  }

  get status(): ConnectionOfferStatus {
    return this.state.status;
  }

  static offer(props: {
    readonly id: ConnectionOfferId;
    readonly fromId: MemberId;
    readonly toId: MemberId;
    readonly source: ConnectionOfferSource;
    readonly now: Date;
  }): Result<ConnectionOffer, SocialError> {
    if (props.fromId === props.toId) return err(SocialError.selfFollow());
    const offer = new ConnectionOffer({
      id: props.id,
      fromId: props.fromId,
      toId: props.toId,
      source: props.source,
      status: "pending",
      createdAt: props.now,
      expiresAt: new Date(props.now.getTime() + CONNECTION_OFFER_TTL_MS),
    });
    offer.record(
      new ConnectionOffered(
        props.id,
        props.fromId,
        props.toId,
        props.source,
        props.now,
      ),
    );
    return ok(offer);
  }

  // Still answerable: pending and not past its expiry (expiry is lazy, so a pending row may be due).
  isOpen(now: Date): boolean {
    return this.state.status === "pending" && now < this.state.expiresAt;
  }

  accept(by: MemberId, now: Date): Result<void, SocialError> {
    const guard = this.guardAnswer(by, now);
    if (guard.isErr) return guard;
    this.state = { ...this.state, status: "accepted", respondedAt: now };
    return ok(undefined);
  }

  decline(by: MemberId, now: Date): Result<void, SocialError> {
    const guard = this.guardAnswer(by, now);
    if (guard.isErr) return guard;
    this.state = { ...this.state, status: "declined", respondedAt: now };
    return ok(undefined);
  }

  // The scheduled (or lazy) expiry: only a pending offer at or past its expiry instant.
  expire(now: Date): Result<void, SocialError> {
    if (this.state.status !== "pending") {
      return err(SocialError.connectionOfferNotPending());
    }
    if (now < this.state.expiresAt) {
      return err(SocialError.connectionOfferNotDue());
    }
    this.state = { ...this.state, status: "expired" };
    return ok(undefined);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: ConnectionOfferState): ConnectionOffer {
    return new ConnectionOffer(state);
  }

  toState(): ConnectionOfferState {
    return this.state;
  }

  private guardAnswer(by: MemberId, now: Date): Result<void, SocialError> {
    if (by !== this.state.toId) {
      return err(SocialError.notConnectionOfferRecipient());
    }
    if (this.state.status !== "pending") {
      return err(SocialError.connectionOfferNotPending());
    }
    if (now >= this.state.expiresAt) {
      return err(SocialError.connectionOfferExpired());
    }
    return ok(undefined);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
