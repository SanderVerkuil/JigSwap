import { MemberId, MembershipId } from "./ids";
import { PermissionLevel } from "./permission-level";

// The persistable shape of a single membership row within a Circle. A child entity of the Circle
// aggregate: it has its own identity (MembershipId) but is only ever reached through its Circle,
// which guards every change so the invariants hold.
export interface MembershipState {
  readonly id: MembershipId;
  readonly memberId: MemberId;
  readonly permission: PermissionLevel;
  readonly joinedAt: Date;
}

// Membership: a member's seat in a circle at a given permission. Immutable; the aggregate replaces
// the whole row (via withPermission) rather than mutating in place, so events stay the only signal
// of change.
export class Membership {
  private constructor(private readonly state: MembershipState) {}

  get id(): MembershipId {
    return this.state.id;
  }

  get memberId(): MemberId {
    return this.state.memberId;
  }

  get permission(): PermissionLevel {
    return this.state.permission;
  }

  get joinedAt(): Date {
    return this.state.joinedAt;
  }

  static create(
    id: MembershipId,
    memberId: MemberId,
    permission: PermissionLevel,
    joinedAt: Date,
  ): Membership {
    return new Membership({ id, memberId, permission, joinedAt });
  }

  // A copy of this membership at a new permission level, preserving identity and join time.
  withPermission(permission: PermissionLevel): Membership {
    return new Membership({ ...this.state, permission });
  }

  static rehydrate(state: MembershipState): Membership {
    return new Membership(state);
  }

  toState(): MembershipState {
    return this.state;
  }
}
