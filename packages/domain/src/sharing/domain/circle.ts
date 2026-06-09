import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { SharingError } from "./errors";
import { CircleCreated, CopySharedToCircle, MemberJoinedCircle } from "./events";
import { CircleId, CopyId, MemberId, MembershipId } from "./ids";
import { Membership } from "./membership";
import { canManageMembers, PermissionLevel } from "./permission-level";

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

  // Add a member at a permission level. Only an Admin actor may do so; the member must not already
  // belong. Emits MemberJoinedCircle.
  addMember(
    actor: MemberId,
    membershipId: MembershipId,
    memberId: MemberId,
    permission: PermissionLevel,
    now: Date,
  ): Result<void, SharingError> {
    const gate = this.requireAdmin(actor);
    if (gate.isErr) return err(gate.error);
    if (this.isMember(memberId)) return err(SharingError.alreadyMember());

    this.memberships.push(Membership.create(membershipId, memberId, permission, now));
    this.record(new MemberJoinedCircle(this.state.id, memberId, now));
    return ok(undefined);
  }

  // Remove a member. Only an Admin actor may do so; the target must be a member and must not be the
  // owner (the owner's seat is permanent).
  removeMember(actor: MemberId, memberId: MemberId): Result<void, SharingError> {
    const gate = this.requireAdmin(actor);
    if (gate.isErr) return err(gate.error);
    if (memberId === this.state.ownerId) return err(SharingError.cannotRemoveOwner());
    if (!this.isMember(memberId)) return err(SharingError.notAMember());

    this.memberships = this.memberships.filter((m) => m.memberId !== memberId);
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
    if (memberId === this.state.ownerId) return err(SharingError.cannotRemoveOwner());

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
  shareCopy(actor: MemberId, copyId: CopyId, now: Date): Result<void, SharingError> {
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
    return { ...this.state, memberships: this.memberships.map((m) => m.toState()) };
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

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
