import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { HouseholdError } from "./errors";
import { HouseholdJoinRequestApproved, HouseholdJoinRequested } from "./events";
import { Household, type HouseholdLeaveConsequence } from "./household";
import { HouseholdId, HouseholdJoinRequestId, MemberId } from "./ids";

// A request lapses this long after it was sent; lapsing is read from expiresAt, never stored.
export const HOUSEHOLD_JOIN_REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type HouseholdJoinRequestStatus =
  "pending" | "approved" | "declined" | "withdrawn" | "void";

// The requester's consent, given when they asked while in another household: which household they
// agreed to leave and what leaving it would do. Approval goes ahead only while both still hold.
export interface HouseholdJoinRequestLeave {
  readonly householdId: HouseholdId;
  readonly consequence: HouseholdLeaveConsequence;
}

export interface HouseholdJoinRequestState {
  readonly id: HouseholdJoinRequestId;
  readonly householdId: HouseholdId;
  readonly requesterId: MemberId;
  // The admin who minted the link the request was asked from: the one told about it.
  readonly adminId: MemberId;
  // The invite link it was asked from (an opaque reference; one request per link, ever).
  readonly linkId: string;
  readonly status: HouseholdJoinRequestStatus;
  // Kept for privacy, never shown to an admin: the household was gone, the link's owner was no
  // longer its admin, or the pair was blocked. The requester sees it as waiting until it lapses.
  readonly dropped: boolean;
  readonly leave?: HouseholdJoinRequestLeave;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt?: Date;
}

// A member's request to join a household, asked from an expired or used invite link:
// pending → approved | declined | withdrawn | void. Approval is the admin's; the join itself (and
// leaving the requester's current household) is orchestrated by the application layer. A declined
// request looks pending to the requester (decline is silent), so they may still withdraw it.
export class HouseholdJoinRequest {
  private events: DomainEvent[] = [];

  private constructor(private state: HouseholdJoinRequestState) {}

  get id(): HouseholdJoinRequestId {
    return this.state.id;
  }

  get householdId(): HouseholdId {
    return this.state.householdId;
  }

  get requesterId(): MemberId {
    return this.state.requesterId;
  }

  get status(): HouseholdJoinRequestStatus {
    return this.state.status;
  }

  get dropped(): boolean {
    return this.state.dropped;
  }

  static request(props: {
    readonly id: HouseholdJoinRequestId;
    readonly householdId: HouseholdId;
    readonly requesterId: MemberId;
    readonly adminId: MemberId;
    readonly linkId: string;
    readonly leave?: HouseholdJoinRequestLeave;
    readonly dropped: boolean;
    readonly now: Date;
  }): Result<HouseholdJoinRequest, HouseholdError> {
    if (props.requesterId === props.adminId) {
      return err(HouseholdError.selfJoinRequest());
    }
    const request = new HouseholdJoinRequest({
      id: props.id,
      householdId: props.householdId,
      requesterId: props.requesterId,
      adminId: props.adminId,
      linkId: props.linkId,
      status: "pending",
      dropped: props.dropped,
      ...(props.leave && { leave: props.leave }),
      createdAt: props.now,
      expiresAt: new Date(props.now.getTime() + HOUSEHOLD_JOIN_REQUEST_TTL_MS),
    });
    if (!props.dropped) {
      request.record(
        new HouseholdJoinRequested(
          props.id,
          props.householdId,
          props.requesterId,
          props.adminId,
          props.now,
        ),
      );
    }
    return ok(request);
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.state.expiresAt.getTime();
  }

  // Open as the requester sees it: waiting (a silent decline and a dropped request included) and
  // not lapsed.
  isOpen(now: Date): boolean {
    return (
      (this.state.status === "pending" || this.state.status === "declined") &&
      !this.isExpired(now)
    );
  }

  // What an admin may still answer: pending, not dropped, not lapsed.
  isActionable(now: Date): boolean {
    return (
      this.state.status === "pending" &&
      !this.state.dropped &&
      !this.isExpired(now)
    );
  }

  // Whether the requester's consent still matches where they are: in no household when they gave
  // none, else still in the household they agreed to leave, with the same consequence.
  consentHolds(current: Household | null): boolean {
    const leave = this.state.leave;
    if (!leave) return current === null;
    return (
      current !== null &&
      current.id === leave.householdId &&
      current.leaveConsequenceFor(this.state.requesterId) === leave.consequence
    );
  }

  approve(by: MemberId, now: Date): Result<void, HouseholdError> {
    if (!this.isActionable(now)) {
      return err(HouseholdError.joinRequestNotPending());
    }
    this.state = { ...this.state, status: "approved", respondedAt: now };
    this.record(
      new HouseholdJoinRequestApproved(
        this.state.id,
        this.state.householdId,
        this.state.requesterId,
        by,
        now,
      ),
    );
    return ok(undefined);
  }

  // Silent: no event.
  decline(now: Date): Result<void, HouseholdError> {
    if (!this.isActionable(now)) {
      return err(HouseholdError.joinRequestNotPending());
    }
    this.state = { ...this.state, status: "declined", respondedAt: now };
    return ok(undefined);
  }

  withdraw(by: MemberId, now: Date): Result<void, HouseholdError> {
    if (by !== this.state.requesterId)
      return err(HouseholdError.notRequester());
    if (!this.isOpen(now)) return err(HouseholdError.joinRequestNotPending());
    this.state = { ...this.state, status: "withdrawn", respondedAt: now };
    return ok(undefined);
  }

  // The request can no longer be approved as consented (the requester's household situation
  // changed): it is closed for good, silently.
  void(now: Date): Result<void, HouseholdError> {
    if (this.state.status !== "pending") {
      return err(HouseholdError.joinRequestNotPending());
    }
    this.state = { ...this.state, status: "void", respondedAt: now };
    return ok(undefined);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: HouseholdJoinRequestState): HouseholdJoinRequest {
    return new HouseholdJoinRequest(state);
  }

  toState(): HouseholdJoinRequestState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
