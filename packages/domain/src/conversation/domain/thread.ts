import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { ConversationError } from "./errors";
import { MessagePosted } from "./events";
import { ExchangeId, MemberId, MessageId, ThreadId } from "./ids";
import { Message, MessageState } from "./message";

// A participant's read position: the instant up to which they have read the thread. Absent until
// a participant marks read for the first time.
export interface ReadReceipt {
  readonly memberId: MemberId;
  readonly lastReadAt: Date;
}

// Input to post a member-authored message: the new message's id, the posting member, whether it
// is text or image (system is excluded — those go through postSystemMessage), the body, and the
// send instant. The author and body are validated against the aggregate's own data.
export interface PostMessageProps {
  readonly id: MessageId;
  readonly authorId: MemberId;
  readonly kind: "text" | "image";
  readonly body: string;
  readonly sentAt: Date;
}

// Input to post a service-authored system message: no member author, just the body and instant.
export interface PostSystemMessageProps {
  readonly id: MessageId;
  readonly body: string;
  readonly sentAt: Date;
}

// The persistable shape of a Thread, kept close to the storage columns so the 1b mapper is a
// field-for-field translation. Messages and receipts are stored as their own flat state arrays.
export interface ThreadState {
  readonly id: ThreadId;
  readonly exchangeId: ExchangeId;
  readonly participants: readonly MemberId[];
  readonly messages: readonly MessageState[];
  readonly readReceipts: readonly ReadReceipt[];
}

// Thread: the Conversation aggregate root, one per ExchangeId. It owns the participant set, the
// ordered message log, and a per-participant ReadReceipt. Every invariant it enforces is decided
// from its own data: a non-participant cannot post; a member cannot author a system message;
// bodies are non-empty; marking read touches only the caller's receipt.
export class Thread {
  private events: DomainEvent[] = [];

  private constructor(
    private readonly state: {
      readonly id: ThreadId;
      readonly exchangeId: ExchangeId;
      readonly participants: readonly MemberId[];
      messages: MessageState[];
      readReceipts: ReadReceipt[];
    },
  ) {}

  get id(): ThreadId {
    return this.state.id;
  }

  get exchangeId(): ExchangeId {
    return this.state.exchangeId;
  }

  get participants(): readonly MemberId[] {
    return this.state.participants;
  }

  get messages(): readonly Message[] {
    return this.state.messages.map((m) => Message.fromState(m));
  }

  get readReceipts(): readonly ReadReceipt[] {
    return this.state.readReceipts;
  }

  // Open a fresh thread scoped to an exchange between its participants. No window/uniqueness
  // checks live here — ensuring one thread per exchange is an application concern (the use case
  // looks up by exchange first), so opening is a pure constructor.
  static open(
    id: ThreadId,
    exchangeId: ExchangeId,
    participants: readonly MemberId[],
  ): Thread {
    return new Thread({
      id,
      exchangeId,
      participants: [...participants],
      messages: [],
      readReceipts: [],
    });
  }

  // Append a member-authored text/image message. Rejects a non-participant author and an empty
  // body; records MessagePosted on success.
  postMessage(props: PostMessageProps): Result<Message, ConversationError> {
    if (!this.isParticipant(props.authorId)) {
      return err(ConversationError.notParticipant());
    }
    if (props.body.length === 0) {
      return err(ConversationError.emptyMessage());
    }

    return ok(
      this.append(
        {
          id: props.id,
          authorId: props.authorId,
          kind: props.kind,
          body: props.body,
          sentAt: props.sentAt,
        },
        props.sentAt,
      ),
    );
  }

  // Append a service-authored system message. There is no member author and no participant check
  // (the service is trusted); only the non-empty-body rule applies. This is the ONLY path that
  // creates a `system` message — a member can never author one (see postMessage's kind type).
  postSystemMessage(
    props: PostSystemMessageProps,
  ): Result<Message, ConversationError> {
    if (props.body.length === 0) {
      return err(ConversationError.emptyMessage());
    }

    return ok(
      this.append(
        {
          id: props.id,
          authorId: null,
          kind: "system",
          body: props.body,
          sentAt: props.sentAt,
        },
        props.sentAt,
      ),
    );
  }

  // Mark the thread read by a participant up to `now`. Updates ONLY the calling participant's
  // receipt (upsert), never anyone else's. A non-participant cannot hold a read position.
  markRead(memberId: MemberId, now: Date): Result<void, ConversationError> {
    if (!this.isParticipant(memberId)) {
      return err(ConversationError.notParticipant());
    }

    const others = this.state.readReceipts.filter(
      (r) => r.memberId !== memberId,
    );
    this.state.readReceipts = [...others, { memberId, lastReadAt: now }];
    return ok(undefined);
  }

  // The last instant `memberId` read the thread, or null if they have not read it yet.
  lastReadAt(memberId: MemberId): Date | null {
    return (
      this.state.readReceipts.find((r) => r.memberId === memberId)
        ?.lastReadAt ?? null
    );
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: ThreadState): Thread {
    return new Thread({
      id: state.id,
      exchangeId: state.exchangeId,
      participants: [...state.participants],
      messages: [...state.messages],
      readReceipts: [...state.readReceipts],
    });
  }

  toState(): ThreadState {
    return {
      id: this.state.id,
      exchangeId: this.state.exchangeId,
      participants: [...this.state.participants],
      messages: [...this.state.messages],
      readReceipts: [...this.state.readReceipts],
    };
  }

  private isParticipant(memberId: MemberId): boolean {
    return this.state.participants.includes(memberId);
  }

  // Shared tail of both post paths: append the validated message and record MessagePosted.
  private append(messageState: MessageState, occurredAt: Date): Message {
    this.state.messages.push(messageState);
    this.record(
      new MessagePosted(
        this.state.id,
        this.state.exchangeId,
        messageState.authorId,
        messageState.id,
        messageState.kind,
        occurredAt,
      ),
    );
    return Message.fromState(messageState);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
