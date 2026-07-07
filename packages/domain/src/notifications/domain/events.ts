import { DomainEvent } from "../../shared-kernel";
import { Channel } from "./channel";
import { MemberId, NotificationId } from "./ids";
import { NotificationType } from "./notification-type";

// All Notifications domain events implement DomainEvent (name + occurredAt). They are plain
// immutable records the aggregate records; an outbound publisher serialises and dispatches them
// (e.g. a delivery adapter that actually sends the email/push for the created notification).

// A notification was created and is awaiting / has had delivery on its channel.
export class NotificationCreated implements DomainEvent {
  readonly name = "NotificationCreated";
  constructor(
    readonly notificationId: NotificationId,
    readonly userId: MemberId,
    readonly type: NotificationType,
    readonly channel: Channel,
    readonly occurredAt: Date,
  ) {}
}

// The recipient read a notification (first time only; markRead is idempotent and won't re-emit).
export class NotificationRead implements DomainEvent {
  readonly name = "NotificationRead";
  constructor(
    readonly notificationId: NotificationId,
    readonly userId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// A member changed whether a given (type, channel) is enabled.
export class PreferenceChanged implements DomainEvent {
  readonly name = "PreferenceChanged";
  constructor(
    readonly memberId: MemberId,
    readonly type: NotificationType,
    readonly channel: Channel,
    readonly enabled: boolean,
    readonly occurredAt: Date,
  ) {}
}

export type NotificationDomainEvent =
  NotificationCreated | NotificationRead | PreferenceChanged;
