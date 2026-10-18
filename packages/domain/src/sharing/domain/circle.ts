import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import type { CircleInvite } from "./circle-invite";
import { SharingError } from "./errors";
import {
  CircleCreated,
  CopySharedToCircle,
  MemberJoinedCircle,
  MemberLeftCircle,
  MemberLeftCircleReason,
} from "./events";
import { CircleId, CopyId, MemberId, MembershipId } from "./ids";
import { Membership } from "./membership";
import { canManageMembers, PermissionLevel } from "./permission-level";

// The most seats a circle may hold, the owner's included.
export const MAX_CIRCLE_MEMBERS = 50;

// Input to create(): a new private group and its first (owner) membership.
export interface CreateCircleProps {
  readonly id: CircleId;
  readonly ownerId: MemberId;
  readonly ownerMembershipId: MembershipId;
  readonly name: string;
  readonly now: Date;
}

// The persistable shape of a Circle. The membership list is part of the aggregate (loaded/saved as
// one unit) so every invariant — admin-gated changes, no duplicate member, owner is permanent —
// can be enforced against the whole set in one place.
export interface CircleState {
  readonly id: CircleId;
  readonly ownerId: MemberId;
  readonly name: string;
  readonly memberships: readonly ReturnType<Membership["toState"]>[];
  readonly createdAt: Date;
}

// The Circle aggregate root: a private group of members, each at a PermissionLevel. The owner is
// implicitly Admin and always a member. Membership operations are gated on the ACTOR holding Admin
// (so authorisation is a domain rule, not an app-layer afterthought); content is only visible to
// members, which the VisibilityPolicy reads off `isMember`.
export class Circle {
  private events: DomainEvent[] = [];

  private constructor(
    private readonly state: CircleState,
    private memberships: Membership[],
  ) {}

  get id(): CircleId {
    return this.state.id;
  }

  get ownerId(): MemberId {
    return this.state.ownerId;
  }

  get name(): string {
    return this.state.name;
  }

  get members(): readonly Membership[] {
    return this.memberships;
  }

  // Open a new circle. The owner is seeded as the first membership at Admin — the owner is
  // implicitly Admin and can never be demoted or removed.
  static create(props: CreateCircleProps): Circle {
    const owner = Membership.create(
      props.ownerMembershipId,
      props.ownerId,
      "Admin",
      props.now,
    );
    const circle = new Circle(
      {
        id: props.id,
        ownerId: props.ownerId,
        name: props.name,
        memberships: [owner.toState()],
        createdAt: props.now,
      },
      [owner],
    );
    circle.record(new CircleCreated(props.id, props.ownerId, props.now));
    return circle;
  }

  // Is this member currently in the circle? The owner is always a member; the VisibilityPolicy
  // uses this to decide friend-circle visibility (content is visible only while a member).
  isMember(memberId: MemberId): boolean {
    return this.memberships.some((m) => m.memberId === memberId);
  }

  // Does this member hold Admin here? The owner always does.
  isAdmin(memberId: MemberId): boolean {
    return this.requireAdmin(memberId).isOk;
  }

  // Add a member at a permission level. Only an Admin actor may do so; the member must not already
  // belong and the circle must have a free seat. Emits MemberJoinedCircle.
  addMember(
    actor: MemberId,
    membershipId: MembershipId,
    memberId: MemberId,
    permission: PermissionLevel,
    now: Date,
  ): Result<void, SharingError> {
    const gate = this.requireAdmin(actor);
    if (gate.isErr) return err(gate.error);
    return this.seat(membershipId, memberId, permission, now);
  }

  // Seat the invitee of an accepted invite, at the invite's permission. Authorised by the invite
  // rather than by an acting Admin: the invite must be to THIS circle and accepted, and its inviter
  // must STILL be an Admin here (an inviter who lost Admin or left can't bring anyone in). The same
  // already-member and seat-cap rules as addMember apply. Emits MemberJoinedCircle.
  admitInvitee(
    invite: CircleInvite,
    membershipId: MembershipId,
    now: Date,
  ): Result<void, SharingError> {
    if (invite.circleId !== this.state.id || invite.status !== "accepted") {
      return err(SharingError.inviteNotAccepted());
    }
    const gate = this.requireAdmin(invite.inviterId);
    if (gate.isErr) return err(gate.error);
    return this.seat(membershipId, invite.inviteeId, invite.permission, now);
  }

  // Remove a member. Only an Admin actor may do so; the target must be a member and must not be the
  // owner (the owner's seat is permanent). Emits MemberLeftCircle with reason "removed".
  removeMember(
    actor: MemberId,
    memberId: MemberId,
    now: Date,
  ): Result<void, SharingError> {
    const gate = this.requireAdmin(actor);
    if (gate.isErr) return err(gate.error);
    if (memberId === this.state.ownerId)
      return err(SharingError.cannotRemoveOwner());
    if (!this.isMember(memberId)) return err(SharingError.notAMember());

    this.dropMember(memberId, "removed", now);
    return ok(undefined);
  }

  // A member walks out of the circle on their own. Any member may leave except the owner, whose
  // seat is permanent. Emits MemberLeftCircle with reason "left".
  leave(memberId: MemberId, now: Date): Result<void, SharingError> {
    if (memberId === this.state.ownerId)
      return err(SharingError.ownerCannotLeave());
    if (!this.isMember(memberId)) return err(SharingError.notAMember());

    this.dropMember(memberId, "left", now);
    return ok(undefined);
  }

  // Change a member's permission. Only an Admin actor may do so; the target must be a member, must
  // not be the owner (the owner stays Admin), and the change must be a real one.
  changePermission(
    actor: MemberId,
    memberId: MemberId,
    permission: PermissionLevel,
  ): Result<void, SharingError> {
    const gate = this.requireAdmin(actor);
    if (gate.isErr) return err(gate.error);
    if (memberId === this.state.ownerId)
      return err(SharingError.cannotRemoveOwner());

    const current = this.memberships.find((m) => m.memberId === memberId);
    if (!current) return err(SharingError.notAMember());
    if (current.permission === permission) {
      return err(SharingError.duplicatePermission());
    }

    this.memberships = this.memberships.map((m) =>
      m.memberId === memberId ? m.withPermission(permission) : m,
    );
    return ok(undefined);
  }

  // Share a copy into this circle, making it visible to the circle's members. Only an Admin actor
  // may share. Emits CopySharedToCircle; the aggregate holds no copy state (the link lives in a
  // read model fed by the event), so this is a pure authorisation + announcement.
  shareCopy(
    actor: MemberId,
    copyId: CopyId,
    now: Date,
  ): Result<void, SharingError> {
    const gate = this.requireAdmin(actor);
    if (gate.isErr) return err(gate.error);

    this.record(new CopySharedToCircle(this.state.id, copyId, now));
    return ok(undefined);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: CircleState): Circle {
    return new Circle(state, state.memberships.map(Membership.rehydrate));
  }

  toState(): CircleState {
    return {
      ...this.state,
      memberships: this.memberships.map((m) => m.toState()),
    };
  }

  // --- internals ---

  // Membership management is Admin-only. The owner is implicitly Admin, so this also passes for the
  // owner even though their seat is independently guaranteed Admin.
  private requireAdmin(actor: MemberId): Result<void, SharingError> {
    const seat = this.memberships.find((m) => m.memberId === actor);
    if (!seat || !canManageMembers(seat.permission)) {
      return err(SharingError.notCircleAdmin());
    }
    return ok(undefined);
  }

  private seat(
    membershipId: MembershipId,
    memberId: MemberId,
    permission: PermissionLevel,
    now: Date,
  ): Result<void, SharingError> {
    if (this.isMember(memberId)) return err(SharingError.alreadyMember());
    if (this.memberships.length >= MAX_CIRCLE_MEMBERS) {
      return err(SharingError.circleFull());
    }

    this.memberships.push(
      Membership.create(membershipId, memberId, permission, now),
    );
    this.record(new MemberJoinedCircle(this.state.id, memberId, now));
    return ok(undefined);
  }

  private dropMember(
    memberId: MemberId,
    reason: MemberLeftCircleReason,
    now: Date,
  ): void {
    this.memberships = this.memberships.filter((m) => m.memberId !== memberId);
    this.record(new MemberLeftCircle(this.state.id, memberId, reason, now));
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
