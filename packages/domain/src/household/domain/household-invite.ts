import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { HouseholdError } from "./errors";
import {
  HouseholdInviteAccepted,
  HouseholdInviteDeclined,
  HouseholdInviteSent,
} from "./events";
import { HouseholdId, HouseholdInviteId, MemberId } from "./ids";

// An invite lapses this long after it was sent (like a request to join); lapsing is read from
// createdAt, never stored, so existing invites need no new field. A lapsed invite reads as missing.
export const HOUSEHOLD_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type HouseholdInviteStatus = "pending" | "accepted" | "declined";

export interface HouseholdInviteState {
  readonly id: HouseholdInviteId;
  readonly householdId: HouseholdId;
  readonly inviterId: MemberId;
  readonly inviteeId: MemberId;
  readonly status: HouseholdInviteStatus;
  readonly createdAt: Date;
  readonly respondedAt?: Date;
}

// An invitation to join a household: pending → accepted | declined, answered only by the invitee.
// Joining (admitting into the Household) and the at-most-one-household rule are orchestrated by the
// application layer on accept, which also refuses a lapsed invite (isExpired).
export class HouseholdInvite {
  private events: DomainEvent[] = [];

  private constructor(private state: HouseholdInviteState) {}

  get id(): HouseholdInviteId {
    return this.state.id;
  }

  get householdId(): HouseholdId {
    return this.state.householdId;
  }

  get inviterId(): MemberId {
    return this.state.inviterId;
  }

  get inviteeId(): MemberId {
    return this.state.inviteeId;
  }

  get status(): HouseholdInviteStatus {
    return this.state.status;
  }

  static send(props: {
    readonly id: HouseholdInviteId;
    readonly householdId: HouseholdId;
    readonly inviterId: MemberId;
    readonly inviteeId: MemberId;
    readonly now: Date;
  }): Result<HouseholdInvite, HouseholdError> {
    if (props.inviterId === props.inviteeId) {
      return err(HouseholdError.selfInvite());
    }
    const invite = new HouseholdInvite({
      id: props.id,
      householdId: props.householdId,
      inviterId: props.inviterId,
      inviteeId: props.inviteeId,
      status: "pending",
      createdAt: props.now,
    });
    invite.record(
      new HouseholdInviteSent(
        props.id,
        props.householdId,
        props.inviterId,
        props.inviteeId,
        props.now,
      ),
    );
    return ok(invite);
  }

  isExpired(now: Date): boolean {
    return (
      now.getTime() >= this.state.createdAt.getTime() + HOUSEHOLD_INVITE_TTL_MS
    );
  }

  accept(by: MemberId, now: Date): Result<void, HouseholdError> {
    const guard = this.guardResponse(by);
    if (guard.isErr) return guard;
    this.state = { ...this.state, status: "accepted", respondedAt: now };
    this.record(
      new HouseholdInviteAccepted(
        this.state.id,
        this.state.householdId,
        this.state.inviterId,
        this.state.inviteeId,
        now,
      ),
    );
    return ok(undefined);
  }

  decline(by: MemberId, now: Date): Result<void, HouseholdError> {
    const guard = this.guardResponse(by);
    if (guard.isErr) return guard;
    this.state = { ...this.state, status: "declined", respondedAt: now };
    this.record(
      new HouseholdInviteDeclined(
        this.state.id,
        this.state.householdId,
        this.state.inviterId,
        this.state.inviteeId,
        now,
      ),
    );
    return ok(undefined);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: HouseholdInviteState): HouseholdInvite {
    return new HouseholdInvite(state);
  }

  toState(): HouseholdInviteState {
    return this.state;
  }

  private guardResponse(by: MemberId): Result<void, HouseholdError> {
    if (by !== this.state.inviteeId) return err(HouseholdError.notInvitee());
    if (this.state.status !== "pending") {
      return err(HouseholdError.inviteNotPending());
    }
    return ok(undefined);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
