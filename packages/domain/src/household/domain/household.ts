import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { HouseholdError } from "./errors";
import {
  HouseholdDissolved,
  HouseholdFounded,
  HouseholdMemberJoined,
  HouseholdMemberLeft,
  HouseholdMemberRemoved,
} from "./events";
import { HouseholdId, MemberId } from "./ids";

export type HouseholdRole = "admin" | "member";

export interface HouseholdMember {
  readonly memberId: MemberId;
  readonly role: HouseholdRole;
  readonly joinedAt: Date;
}

export interface HouseholdState {
  readonly id: HouseholdId;
  readonly members: readonly HouseholdMember[];
  readonly createdAt: Date;
}

// Household: the members who pool their libraries. The founder is the admin (invites + removes);
// when the admin leaves, the longest-standing remaining member is promoted; when the last member
// leaves the household is dissolved. "At most one household per member" spans aggregates and is
// enforced by the application layer.
export class Household {
  private events: DomainEvent[] = [];

  private constructor(private state: HouseholdState) {}

  get id(): HouseholdId {
    return this.state.id;
  }

  get members(): readonly HouseholdMember[] {
    return this.state.members;
  }

  isMember(memberId: MemberId): boolean {
    return this.state.members.some((m) => m.memberId === memberId);
  }

  isAdmin(memberId: MemberId): boolean {
    return this.state.members.some(
      (m) => m.memberId === memberId && m.role === "admin",
    );
  }

  static found(props: {
    readonly id: HouseholdId;
    readonly founderId: MemberId;
    readonly now: Date;
  }): Household {
    const household = new Household({
      id: props.id,
      members: [
        { memberId: props.founderId, role: "admin", joinedAt: props.now },
      ],
      createdAt: props.now,
    });
    household.record(
      new HouseholdFounded(props.id, props.founderId, props.now),
    );
    return household;
  }

  admit(memberId: MemberId, now: Date): Result<void, HouseholdError> {
    if (this.isMember(memberId)) return err(HouseholdError.alreadyMember());
    this.state = {
      ...this.state,
      members: [
        ...this.state.members,
        { memberId, role: "member", joinedAt: now },
      ],
    };
    this.record(new HouseholdMemberJoined(this.state.id, memberId, now));
    return ok(undefined);
  }

  leave(
    memberId: MemberId,
    now: Date,
  ): Result<{ readonly dissolved: boolean }, HouseholdError> {
    if (!this.isMember(memberId)) return err(HouseholdError.notAMember());
    this.drop(memberId);
    this.record(new HouseholdMemberLeft(this.state.id, memberId, now));
    if (this.state.members.length === 0) {
      this.record(new HouseholdDissolved(this.state.id, now));
      return ok({ dissolved: true });
    }
    return ok({ dissolved: false });
  }

  remove(
    by: MemberId,
    target: MemberId,
    now: Date,
  ): Result<void, HouseholdError> {
    if (!this.isAdmin(by)) return err(HouseholdError.notHouseholdAdmin());
    if (by === target) return err(HouseholdError.cannotRemoveSelf());
    if (!this.isMember(target)) return err(HouseholdError.notAMember());
    this.drop(target);
    this.record(new HouseholdMemberRemoved(this.state.id, target, by, now));
    return ok(undefined);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: HouseholdState): Household {
    return new Household(state);
  }

  toState(): HouseholdState {
    return this.state;
  }

  // Remove a member; if that leaves remaining members but no admin, promote the longest-standing.
  private drop(memberId: MemberId): void {
    const remaining = this.state.members.filter((m) => m.memberId !== memberId);
    const hasAdmin = remaining.some((m) => m.role === "admin");
    let members = remaining;
    if (!hasAdmin && remaining.length > 0) {
      const senior = remaining.reduce((a, b) =>
        b.joinedAt.getTime() < a.joinedAt.getTime() ? b : a,
      );
      members = remaining.map((m) =>
        m.memberId === senior.memberId ? { ...m, role: "admin" } : m,
      );
    }
    this.state = { ...this.state, members };
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
