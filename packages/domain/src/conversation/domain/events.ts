import { DomainEvent } from "../../shared-kernel";
import { MemberId, MessageId, ThreadId } from "./ids";
import { MessageKind } from "./message";
import { ThreadSubject } from "./thread";

// All Conversation domain events implement DomainEvent (name + occurredAt). They are plain
// immutable records: the Thread records them; an outbound publisher (1b) serialises and
// dispatches them to subscribers (Notifications, the other participant's unread badge).

// A message was appended to a thread. `authorId` is the posting member for member-authored messages
// and null for service-authored system messages. Carries `kind` and the scoping `subject` so
// subscribers need not reload the thread to route a notification.
export class MessagePosted implements DomainEvent {
  readonly name = "MessagePosted";
  constructor(
    readonly threadId: ThreadId,
    readonly subject: ThreadSubject,
    readonly authorId: MemberId | null,
    readonly messageId: MessageId,
    readonly kind: MessageKind,
    readonly occurredAt: Date,
  ) {}
}

// A member joined a circle thread's participant set (lazy creation seeds the roster without
// events; this records a later join or re-join). `joinedAt` is the new history floor.
export class ParticipantJoined implements DomainEvent {
  readonly name = "ParticipantJoined";
  constructor(
    readonly threadId: ThreadId,
    readonly subject: ThreadSubject,
    readonly memberId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// A member left a circle thread's participant set, by leaving or by being removed from the
// circle. The two are not told apart and the remover is never recorded.
export class ParticipantLeft implements DomainEvent {
  readonly name = "ParticipantLeft";
  constructor(
    readonly threadId: ThreadId,
    readonly subject: ThreadSubject,
    readonly memberId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

export type ConversationDomainEvent =
  MessagePosted | ParticipantJoined | ParticipantLeft;
