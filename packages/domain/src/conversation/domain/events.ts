import { DomainEvent } from "../../shared-kernel";
import { ExchangeId, MemberId, MessageId, ThreadId } from "./ids";
import { MessageKind } from "./message";

// All Conversation domain events implement DomainEvent (name + occurredAt). They are plain
// immutable records: the Thread records them; an outbound publisher (1b) serialises and
// dispatches them to subscribers (Notifications, the other participant's unread badge).

// A message was appended to a thread. `authorId` is the posting member for text/image messages
// and null for service-authored system messages. Carries `kind` and the scoping `exchangeId` so
// subscribers need not reload the thread to route a notification.
export class MessagePosted implements DomainEvent {
  readonly name = "MessagePosted";
  constructor(
    readonly threadId: ThreadId,
    readonly exchangeId: ExchangeId,
    readonly authorId: MemberId | null,
    readonly messageId: MessageId,
    readonly kind: MessageKind,
    readonly occurredAt: Date,
  ) {}
}

export type ConversationDomainEvent = MessagePosted;
