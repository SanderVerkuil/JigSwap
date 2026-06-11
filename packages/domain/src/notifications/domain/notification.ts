import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { Channel } from "./channel";
import { NotificationError } from "./errors";
import { NotificationCreated, NotificationRead } from "./events";
import { MemberId, NotificationId } from "./ids";
import { NotificationType } from "./notification-type";

// Input to Notification.create(): the rendered message plus its addressing. `relatedId` points at
// the upstream entity (an exchange, puzzle, thread, …) as an opaque string — Notifications does
// not interpret it. `channel` defaults to inApp at the call site if unspecified.
export interface CreateNotificationProps {
  readonly id: NotificationId;
  readonly userId: MemberId;
  readonly type: NotificationType;
  readonly title: string;
  readonly message: string;
  readonly relatedId?: string;
  readonly channel: Channel;
  readonly now: Date;
}

// The persistable shape, kept deliberately close to the `notifications` table columns so the
// 4a-backend mapper is a trivial field-for-field translation. `channel` is the one column the
// backend slice will add (defaulting existing rows to "inApp").
export interface NotificationState {
  readonly id: NotificationId;
  readonly userId: MemberId;
  readonly type: NotificationType;
  readonly title: string;
  readonly message: string;
  readonly relatedId?: string;
  readonly channel: Channel;
  readonly isRead: boolean;
  readonly createdAt: Date;
}

// Notification: a single delivered (or to-be-delivered) message addressed to one member on one
// channel. A small entity, but an aggregate root for read-tracking: it owns its `isRead` flag and
// the ownership rule on markRead.
export class Notification {
  private events: DomainEvent[] = [];

  private constructor(private state: NotificationState) {}

  get id(): NotificationId {
    return this.state.id;
  }

  get userId(): MemberId {
    return this.state.userId;
  }

  get channel(): Channel {
    return this.state.channel;
  }

  get isRead(): boolean {
    return this.state.isRead;
  }

  // Create a brand-new, unread notification and record NotificationCreated. There is no failure
  // mode here — whether this notification should exist at all (preference policy) is decided by
  // the application layer before calling create.
  static create(props: CreateNotificationProps): Notification {
    const notification = new Notification({
      id: props.id,
      userId: props.userId,
      type: props.type,
      title: props.title,
      message: props.message,
      relatedId: props.relatedId,
      channel: props.channel,
      isRead: false,
      createdAt: props.now,
    });
    notification.record(
      new NotificationCreated(
        props.id,
        props.userId,
        props.type,
        props.channel,
        props.now,
      ),
    );
    return notification;
  }

  // Mark as read on behalf of `by`. Ownership-checked: only the addressee may read it. Idempotent:
  // a second markRead is a no-op (returns ok, records nothing) so it never double-emits.
  markRead(by: MemberId, now: Date): Result<void, NotificationError> {
    if (by !== this.state.userId) {
      return err(NotificationError.notOwner(this.state.id, by));
    }
    if (this.state.isRead) {
      return ok(undefined);
    }
    this.state = { ...this.state, isRead: true };
    this.record(new NotificationRead(this.state.id, this.state.userId, now));
    return ok(undefined);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: NotificationState): Notification {
    return new Notification(state);
  }

  toState(): NotificationState {
    return this.state;
  }

  // --- internals ---

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
