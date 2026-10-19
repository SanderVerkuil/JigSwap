import { DomainEvent } from "../../shared-kernel";
import {
  HouseholdId,
  HouseholdInviteId,
  HouseholdJoinRequestId,
  MemberId,
} from "./ids";

// Household domain events: plain immutable records the aggregates record and the publisher
// serialises into the durable event log (Notifications subscribes to the invite events).

export class HouseholdFounded implements DomainEvent {
  readonly name = "HouseholdFounded";
  constructor(
    readonly householdId: HouseholdId,
    readonly founderId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export class HouseholdMemberJoined implements DomainEvent {
  readonly name = "HouseholdMemberJoined";
  constructor(
    readonly householdId: HouseholdId,
    readonly memberId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export class HouseholdMemberLeft implements DomainEvent {
  readonly name = "HouseholdMemberLeft";
  constructor(
    readonly householdId: HouseholdId,
    readonly memberId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export class HouseholdMemberRemoved implements DomainEvent {
  readonly name = "HouseholdMemberRemoved";
  constructor(
    readonly householdId: HouseholdId,
    readonly memberId: MemberId,
    readonly removedBy: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// The last member left; the household no longer exists.
export class HouseholdDissolved implements DomainEvent {
  readonly name = "HouseholdDissolved";
  constructor(
    readonly householdId: HouseholdId,
    readonly occurredAt: Date,
  ) {}
}

export class HouseholdInviteSent implements DomainEvent {
  readonly name = "HouseholdInviteSent";
  constructor(
    readonly inviteId: HouseholdInviteId,
    readonly householdId: HouseholdId,
    readonly inviterId: MemberId,
    readonly inviteeId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export class HouseholdInviteAccepted implements DomainEvent {
  readonly name = "HouseholdInviteAccepted";
  constructor(
    readonly inviteId: HouseholdInviteId,
    readonly householdId: HouseholdId,
    readonly inviterId: MemberId,
    readonly inviteeId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// Deliberately silent downstream (no notification), mirroring follow-request declines.
export class HouseholdInviteDeclined implements DomainEvent {
  readonly name = "HouseholdInviteDeclined";
  constructor(
    readonly inviteId: HouseholdInviteId,
    readonly householdId: HouseholdId,
    readonly inviterId: MemberId,
    readonly inviteeId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// A member asked to join a household; `adminId` is the admin who minted the link it was asked from
// (the one told). A request dropped for privacy (household gone, owner no longer its admin,
// blocked) records no event, so nobody is told.
export class HouseholdJoinRequested implements DomainEvent {
  readonly name = "HouseholdJoinRequested";
  constructor(
    readonly requestId: HouseholdJoinRequestId,
    readonly householdId: HouseholdId,
    readonly requesterId: MemberId,
    readonly adminId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// The admin let the requester in. Decline, withdraw and void are deliberately silent (no event).
export class HouseholdJoinRequestApproved implements DomainEvent {
  readonly name = "HouseholdJoinRequestApproved";
  constructor(
    readonly requestId: HouseholdJoinRequestId,
    readonly householdId: HouseholdId,
    readonly requesterId: MemberId,
    readonly approverId: MemberId,
    readonly occurredAt: Date,
  ) {}
}
