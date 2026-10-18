import { DomainEvent } from "../../shared-kernel";
import { CircleId, CircleInviteId, CopyId, MemberId } from "./ids";

// All Sharing domain events implement DomainEvent (name + occurredAt). They are plain immutable
// records: the Circle aggregate records them; an outbound publisher serialises and dispatches them
// to subscribers (Notifications, Insights, and any read model of who-can-see-what).

// A private group was opened by its owner. Optional in the spec, but emitting it lets read models
// project a circle without reloading the aggregate.
export class CircleCreated implements DomainEvent {
  readonly name = "CircleCreated";
  constructor(
    readonly circleId: CircleId,
    readonly ownerId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// A member was added to a circle. Drives circle-aware visibility read models and notifications.
export class MemberJoinedCircle implements DomainEvent {
  readonly name = "MemberJoinedCircle";
  constructor(
    readonly circleId: CircleId,
    readonly memberId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// Why a member stopped being part of a circle: they walked out ("left") or an Admin took them out
// ("removed").
export type MemberLeftCircleReason = "left" | "removed";

// A member stopped being part of a circle, by leaving or by an Admin's removal. Drives the
// circle-copy read model (their shares into the circle are withdrawn) and, later, circle chat and
// invitation flows.
export class MemberLeftCircle implements DomainEvent {
  readonly name = "MemberLeftCircle";
  constructor(
    readonly circleId: CircleId,
    readonly memberId: MemberId,
    readonly reason: MemberLeftCircleReason,
    readonly occurredAt: Date,
  ) {}
}

// A copy was shared into a circle (made visible to that circle's members). Carries the copy id so
// Library/Insights need not reload anything to react.
export class CopySharedToCircle implements DomainEvent {
  readonly name = "CopySharedToCircle";
  constructor(
    readonly circleId: CircleId,
    readonly copyId: CopyId,
    readonly occurredAt: Date,
  ) {}
}

// An Admin invited a member to a circle. Carries `expiresAt` so the backend can schedule the
// invite's expiry without reloading it; drives the invitee's circle_invite_received notification.
export class CircleInviteIssued implements DomainEvent {
  readonly name = "CircleInviteIssued";
  constructor(
    readonly inviteId: CircleInviteId,
    readonly circleId: CircleId,
    readonly inviterId: MemberId,
    readonly inviteeId: MemberId,
    readonly expiresAt: Date,
    readonly occurredAt: Date,
  ) {}
}

// The invitee accepted (their MemberJoinedCircle is recorded by the Circle alongside). Drives the
// inviter's circle_invite_accepted notification.
export class CircleInviteAccepted implements DomainEvent {
  readonly name = "CircleInviteAccepted";
  constructor(
    readonly inviteId: CircleInviteId,
    readonly circleId: CircleId,
    readonly inviteeId: MemberId,
    readonly inviterId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// The invitee declined. Silent: no notification is mapped for it.
export class CircleInviteDeclined implements DomainEvent {
  readonly name = "CircleInviteDeclined";
  constructor(
    readonly inviteId: CircleInviteId,
    readonly circleId: CircleId,
    readonly inviteeId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// The inviter or an Admin withdrew a pending invite (`revokedBy`), or the system did because its
// inviter left or lost Admin (`revokedBy` null).
export class CircleInviteRevoked implements DomainEvent {
  readonly name = "CircleInviteRevoked";
  constructor(
    readonly inviteId: CircleInviteId,
    readonly circleId: CircleId,
    readonly revokedBy: MemberId | null,
    readonly occurredAt: Date,
  ) {}
}

// A pending invite reached its expiresAt unanswered.
export class CircleInviteExpired implements DomainEvent {
  readonly name = "CircleInviteExpired";
  constructor(
    readonly inviteId: CircleInviteId,
    readonly circleId: CircleId,
    readonly occurredAt: Date,
  ) {}
}

// The owner deleted the circle. Carries everything its subscribers need, because the circle is
// gone by the time they run: `memberIds` are the members told about it (the owner excluded) and
// `name` is snapshotted for their notification. Drives the inline cleanup (invites, scheduled
// copy-share purge) and the circle_deleted notifications.
export class CircleDeleted implements DomainEvent {
  readonly name = "CircleDeleted";
  constructor(
    readonly circleId: CircleId,
    readonly ownerId: MemberId,
    readonly memberIds: readonly MemberId[],
    readonly circleName: string,
    readonly occurredAt: Date,
  ) {}
}

export type SharingDomainEvent =
  | CircleCreated
  | MemberJoinedCircle
  | MemberLeftCircle
  | CopySharedToCircle
  | CircleInviteIssued
  | CircleInviteAccepted
  | CircleInviteDeclined
  | CircleInviteRevoked
  | CircleInviteExpired
  | CircleDeleted;
