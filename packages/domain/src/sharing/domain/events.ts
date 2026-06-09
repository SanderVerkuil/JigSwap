import { DomainEvent } from "../../shared-kernel";
import { CircleId, CopyId, MemberId } from "./ids";

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

export type SharingDomainEvent =
  | CircleCreated
  | MemberJoinedCircle
  | CopySharedToCircle;
