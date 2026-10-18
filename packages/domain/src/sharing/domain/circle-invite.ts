import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import type { Circle } from "./circle";
import { SharingError } from "./errors";
import {
  CircleInviteAccepted,
  CircleInviteDeclined,
  CircleInviteExpired,
  CircleInviteIssued,
  CircleInviteRevoked,
} from "./events";
import { CircleId, CircleInviteId, MemberId } from "./ids";
import { PermissionLevel } from "./permission-level";

// How long an unanswered circle invite stays open.
export const CIRCLE_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// After the invitee declines or a member revokes an invite, the same (circle, invitee) can't be invited
// again for this long, so an Admin can't keep re-sending an invite someone turned down.
export const CIRCLE_REINVITE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type CircleInviteStatus =
  "pending" | "accepted" | "declined" | "revoked" | "expired";

export interface CircleInviteState {
  readonly id: CircleInviteId;
  readonly circleId: CircleId;
  readonly inviterId: MemberId;
  readonly inviteeId: MemberId;
  // The seat the invitee takes on accepting.
  readonly permission: PermissionLevel;
  readonly status: CircleInviteStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly decidedAt?: Date;
  // Who revoked it; absent when the system withdrew it (its inviter lost the standing to invite).
  readonly revokedBy?: MemberId;
}

// An invitation to join a circle: pending → accepted | declined | revoked | expired. A pending
// invite grants NOTHING (it is not a membership); the invitee only joins when Circle.admitInvitee
// seats them on an accepted invite. Expiry is lazy: once `expiresAt` has passed, a still-pending
// invite behaves as expired for every transition, whether or not it was flipped yet.
export class CircleInvite {
  private events: DomainEvent[] = [];

  private constructor(private state: CircleInviteState) {}

  get id(): CircleInviteId {
    return this.state.id;
  }

  get circleId(): CircleId {
    return this.state.circleId;
  }

  get inviterId(): MemberId {
    return this.state.inviterId;
  }

  get inviteeId(): MemberId {
    return this.state.inviteeId;
  }

  get permission(): PermissionLevel {
    return this.state.permission;
  }

  get status(): CircleInviteStatus {
    return this.state.status;
  }

  get expiresAt(): Date {
    return this.state.expiresAt;
  }

  // Issue a new pending invite expiring CIRCLE_INVITE_TTL_MS from now. Who may invite whom (Admin
  // actor, contact rule, not already a member, the cap) is checked by the application layer; the
  // invite itself only refuses inviting oneself.
  static issue(props: {
    readonly id: CircleInviteId;
    readonly circleId: CircleId;
    readonly inviterId: MemberId;
    readonly inviteeId: MemberId;
    readonly permission: PermissionLevel;
    readonly now: Date;
  }): Result<CircleInvite, SharingError> {
    if (props.inviterId === props.inviteeId) {
      return err(SharingError.cannotInvite());
    }
    const expiresAt = new Date(props.now.getTime() + CIRCLE_INVITE_TTL_MS);
    const invite = new CircleInvite({
      id: props.id,
      circleId: props.circleId,
      inviterId: props.inviterId,
      inviteeId: props.inviteeId,
      permission: props.permission,
      status: "pending",
      createdAt: props.now,
      expiresAt,
    });
    invite.record(
      new CircleInviteIssued(
        props.id,
        props.circleId,
        props.inviterId,
        props.inviteeId,
        expiresAt,
        props.now,
      ),
    );
    return ok(invite);
  }

  // Pending and not yet past its expiry: the only state in which the invite can still be answered.
  isOpenAt(now: Date): boolean {
    return this.state.status === "pending" && now < this.state.expiresAt;
  }

  // Whether this decided invite still holds off a new invite to the same invitee at `now`: it was
  // declined, or revoked by a member, less than CIRCLE_REINVITE_COOLDOWN_MS ago. A system
  // withdrawal (see withdraw) holds nothing off: the invitee did nothing and nobody chose to.
  holdsOffReinviteAt(now: Date): boolean {
    const { status, decidedAt, revokedBy } = this.state;
    return (
      (status === "declined" ||
        (status === "revoked" && revokedBy !== undefined)) &&
      decidedAt !== undefined &&
      now.getTime() < decidedAt.getTime() + CIRCLE_REINVITE_COOLDOWN_MS
    );
  }

  accept(by: MemberId, now: Date): Result<void, SharingError> {
    const guard = this.guardAnswer(by, now);
    if (guard.isErr) return guard;
    this.decide("accepted", now);
    this.record(
      new CircleInviteAccepted(
        this.state.id,
        this.state.circleId,
        this.state.inviteeId,
        this.state.inviterId,
        now,
      ),
    );
    return ok(undefined);
  }

  decline(by: MemberId, now: Date): Result<void, SharingError> {
    const guard = this.guardAnswer(by, now);
    if (guard.isErr) return guard;
    this.decide("declined", now);
    this.record(
      new CircleInviteDeclined(
        this.state.id,
        this.state.circleId,
        this.state.inviteeId,
        now,
      ),
    );
    return ok(undefined);
  }

  // Withdraw an open invite. Allowed for the member who sent it, or any current Admin of the
  // invite's circle.
  revoke(
    actor: MemberId,
    circle: Circle,
    now: Date,
  ): Result<void, SharingError> {
    const allowed =
      actor === this.state.inviterId ||
      (circle.id === this.state.circleId && circle.isAdmin(actor));
    if (!allowed) return err(SharingError.cannotRevokeInvite());
    const open = this.guardOpen(now);
    if (open.isErr) return open;
    this.decide("revoked", now);
    this.state = { ...this.state, revokedBy: actor };
    this.record(
      new CircleInviteRevoked(this.state.id, this.state.circleId, actor, now),
    );
    return ok(undefined);
  }

  // The system withdraws a pending invite whose inviter can no longer stand behind it (they left,
  // were removed, or lost Admin). Recorded as a revoke with no revoker, so it frees its seat
  // under the cap and the ex-inviter can't act on it any more.
  withdraw(now: Date): Result<void, SharingError> {
    if (this.state.status !== "pending") {
      return err(SharingError.inviteNotPending());
    }
    this.decide("revoked", now);
    this.record(
      new CircleInviteRevoked(this.state.id, this.state.circleId, null, now),
    );
    return ok(undefined);
  }

  // Flip a pending invite whose expiresAt has been reached to expired.
  expire(now: Date): Result<void, SharingError> {
    if (this.state.status !== "pending") {
      return err(SharingError.inviteNotPending());
    }
    if (now < this.state.expiresAt) return err(SharingError.inviteNotDue());
    this.decide("expired", now);
    this.record(
      new CircleInviteExpired(this.state.id, this.state.circleId, now),
    );
    return ok(undefined);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: CircleInviteState): CircleInvite {
    return new CircleInvite(state);
  }

  toState(): CircleInviteState {
    return this.state;
  }

  private guardAnswer(by: MemberId, now: Date): Result<void, SharingError> {
    if (by !== this.state.inviteeId) return err(SharingError.notInvitee());
    return this.guardOpen(now);
  }

  private guardOpen(now: Date): Result<void, SharingError> {
    if (this.state.status !== "pending") {
      return err(SharingError.inviteNotPending());
    }
    if (now >= this.state.expiresAt) return err(SharingError.inviteExpired());
    return ok(undefined);
  }

  private decide(status: CircleInviteStatus, now: Date): void {
    this.state = { ...this.state, status, decidedAt: now };
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
