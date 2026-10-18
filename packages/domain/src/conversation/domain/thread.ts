import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import {
  ConversationError,
  MAX_CAPTION_LENGTH,
  MAX_MESSAGE_LENGTH,
} from "./errors";
import { MessagePosted, ParticipantJoined, ParticipantLeft } from "./events";
import {
  CircleId,
  CopyId,
  ExchangeId,
  MemberId,
  MessageId,
  ThreadId,
} from "./ids";
import {
  MediaMessageKind,
  Message,
  MessageState,
  SystemEvent,
} from "./message";

// A thread's subject: what the conversation is about. Exchange threads are opened by the
// system when an exchange is proposed; DM threads are member-opened, exactly two participants.
// Circle threads are one per friend circle; their participant set follows the circle's members.
export type ThreadSubject =
  | { readonly kind: "exchange"; readonly exchangeId: ExchangeId }
  | { readonly kind: "dm" }
  | { readonly kind: "circle"; readonly circleId: CircleId };

// A current participant. `joinedAt` is the participant's history floor in a circle thread: they
// see only messages sent strictly after it (also after a re-join). Absent means "since the thread
// started" — always the case for the fixed pair of an exchange or DM thread, whose participants
// never join later, and for legacy rows stored before joinedAt existed.
export interface ParticipantState {
  readonly memberId: MemberId;
  readonly joinedAt?: Date;
}

// A circle member as seeded into (or joining) a circle thread: joinedAt is required here.
export interface CircleParticipant {
  readonly memberId: MemberId;
  readonly joinedAt: Date;
}

// A participant's read position: the instant up to which they have read the thread. Absent until
// a participant marks read for the first time.
export interface ReadReceipt {
  readonly memberId: MemberId;
  readonly lastReadAt: Date;
}

// Input to post a member-authored message: the new message's id, the posting member, its kind
// (system is excluded — those go through postSystemMessage), the body, and the send instant. For
// `text` the body is the message; for a media kind (`image`, `location`) it is an optional caption
// and `attachmentRef` is required. The author, body and attachment are validated against the
// aggregate's own data.
export interface PostMessageProps {
  readonly id: MessageId;
  readonly authorId: MemberId;
  readonly kind: "text" | MediaMessageKind;
  readonly body: string;
  readonly sentAt: Date;
  // Optional reference to the copy the message is about (see MessageState.copyId).
  readonly copyId?: CopyId;
  // The attachment a media message carries (see MessageState.attachmentRef).
  readonly attachmentRef?: string;
}

// Input to post a service-authored system message: no member author, just the body and instant.
// A circle thread's join/leave row also carries its structured `systemEvent`.
export interface PostSystemMessageProps {
  readonly id: MessageId;
  readonly body: string;
  readonly sentAt: Date;
  readonly systemEvent?: SystemEvent;
}

// The persistable shape of a Thread, kept close to the storage columns so the 1b mapper is a
// field-for-field translation. Messages and receipts are stored as their own flat state arrays.
// `messages` holds ONLY the messages appended in this unit of work: history is never hydrated
// (no invariant reads it), so a rehydrated thread starts with `[]` and the repository inserts
// every entry as new.
export interface ThreadState {
  readonly id: ThreadId;
  readonly subject: ThreadSubject;
  readonly participants: readonly ParticipantState[];
  readonly messages: readonly MessageState[];
  readonly readReceipts: readonly ReadReceipt[];
}

// Thread: the Conversation aggregate root, scoped by its subject (one per ExchangeId for
// exchange threads; a member pair for DMs; one per circle). It owns the participant set (fixed for
// exchange/DM threads; joins and leaves for circle threads), the messages appended in
// this unit of work (the stored log is append-only and never loaded), and a per-participant
// ReadReceipt. Every invariant it enforces is decided from its own data: a
// non-participant cannot post; a member cannot author a system message; text bodies are
// non-empty; media messages carry an attachment and at most a short caption; marking read
// touches only the caller's receipt.
export class Thread {
  private events: DomainEvent[] = [];

  private constructor(
    private readonly state: {
      readonly id: ThreadId;
      readonly subject: ThreadSubject;
      participants: ParticipantState[];
      messages: MessageState[];
      readReceipts: ReadReceipt[];
    },
  ) {}

  get id(): ThreadId {
    return this.state.id;
  }

  get subject(): ThreadSubject {
    return this.state.subject;
  }

  // The current participants' ids, in join order.
  get participants(): readonly MemberId[] {
    return this.state.participants.map((p) => p.memberId);
  }

  // The messages appended in this unit of work, in append order — not the thread's history.
  get messages(): readonly Message[] {
    return this.state.messages.map((m) => Message.fromState(m));
  }

  get readReceipts(): readonly ReadReceipt[] {
    return this.state.readReceipts;
  }

  // Open a fresh thread scoped to an exchange between its participants. No window/uniqueness
  // checks live here — ensuring one thread per exchange is an application concern (the use case
  // looks up by exchange first), so opening is a pure constructor.
  static openForExchange(
    id: ThreadId,
    exchangeId: ExchangeId,
    participants: readonly MemberId[],
  ): Thread {
    return new Thread({
      id,
      subject: { kind: "exchange", exchangeId },
      participants: participants.map((memberId) => ({ memberId })),
      messages: [],
      readReceipts: [],
    });
  }

  // Open a member-to-member DM. The pair rule (exactly two distinct members) is the aggregate's
  // own invariant; the connection gate is an application concern (see makeOpenDmThread).
  static openDm(
    id: ThreadId,
    participants: readonly [MemberId, MemberId],
  ): Result<Thread, ConversationError> {
    if (participants[0] === participants[1]) {
      return err(ConversationError.dmRequiresTwoParticipants());
    }
    return ok(
      new Thread({
        id,
        subject: { kind: "dm" },
        participants: participants.map((memberId) => ({ memberId })),
        messages: [],
        readReceipts: [],
      }),
    );
  }

  // Open a friend circle's thread, seeded with the circle's current members and their joinedAt.
  // At least one participant (a circle with only its owner still has a thread); a member listed
  // twice keeps its first entry. One thread per circle is an application concern, as for exchanges.
  static openForCircle(
    id: ThreadId,
    circleId: CircleId,
    members: readonly CircleParticipant[],
  ): Result<Thread, ConversationError> {
    if (members.length === 0) {
      return err(ConversationError.circleThreadRequiresParticipant());
    }
    const byMember = new Map<MemberId, ParticipantState>();
    for (const { memberId, joinedAt } of members) {
      if (!byMember.has(memberId))
        byMember.set(memberId, { memberId, joinedAt });
    }
    return ok(
      new Thread({
        id,
        subject: { kind: "circle", circleId },
        participants: [...byMember.values()],
        messages: [],
        readReceipts: [],
      }),
    );
  }

  // A member joins a circle thread at `now`. Returns whether the set changed: adding a current
  // participant is a no-op (false; their joinedAt is kept). A re-join after leaving is a fresh
  // entry with joinedAt = now, so the history between leaving and re-joining stays hidden.
  // Records ParticipantJoined. Exchange/DM threads reject with ParticipantsFixed.
  addParticipant(
    memberId: MemberId,
    now: Date,
  ): Result<boolean, ConversationError> {
    if (this.state.subject.kind !== "circle") {
      return err(ConversationError.participantsFixed());
    }
    if (this.isParticipant(memberId)) return ok(false);
    this.state.participants.push({ memberId, joinedAt: now });
    this.record(
      new ParticipantJoined(this.state.id, this.state.subject, memberId, now),
    );
    return ok(true);
  }

  // A member leaves a circle thread at `now` (leaving and removal are one outcome; the remover is
  // not recorded). Returns whether the set changed: removing a non-participant is a no-op (false),
  // so a replayed sync is harmless. Their read receipt goes with them. Records ParticipantLeft.
  // Exchange/DM threads reject with ParticipantsFixed.
  removeParticipant(
    memberId: MemberId,
    now: Date,
  ): Result<boolean, ConversationError> {
    if (this.state.subject.kind !== "circle") {
      return err(ConversationError.participantsFixed());
    }
    if (!this.isParticipant(memberId)) return ok(false);
    this.state.participants = this.state.participants.filter(
      (p) => p.memberId !== memberId,
    );
    this.state.readReceipts = this.state.readReceipts.filter(
      (r) => r.memberId !== memberId,
    );
    this.record(
      new ParticipantLeft(this.state.id, this.state.subject, memberId, now),
    );
    return ok(true);
  }

  // The exclusive lower bound of what `memberId` may see: their joinedAt in a circle thread
  // (messages sent at exactly joinedAt are hidden), null when there is no floor (exchange/DM
  // threads, or a participant without a recorded joinedAt). Says nothing about participation:
  // gate that first, or use canSee, which does both.
  visibleFrom(memberId: MemberId): Date | null {
    if (this.state.subject.kind !== "circle") return null;
    return (
      this.state.participants.find((p) => p.memberId === memberId)?.joinedAt ??
      null
    );
  }

  // Whether `memberId` may see a message sent at `sentAt`: only a current participant, and in a
  // circle thread only strictly after their joinedAt.
  canSee(memberId: MemberId, sentAt: Date): boolean {
    if (!this.isParticipant(memberId)) return false;
    const floor = this.visibleFrom(memberId);
    return floor === null || sentAt.getTime() > floor.getTime();
  }

  // Append a member-authored text or media message. Rejects a non-participant author, then
  // applies the kind's rules: text needs a non-empty body (≤ MAX_MESSAGE_LENGTH) and no
  // attachment; image/location need an attachmentRef and allow an empty caption
  // (≤ MAX_CAPTION_LENGTH). Records MessagePosted on success.
  postMessage(props: PostMessageProps): Result<Message, ConversationError> {
    if (!this.isParticipant(props.authorId)) {
      return err(ConversationError.notParticipant());
    }
    const contentError =
      props.kind === "text"
        ? (Thread.validateTextBody(props.body) ??
          (props.attachmentRef === undefined
            ? null
            : ConversationError.attachmentNotAllowed()))
        : Thread.validateMedia(props.body, props.attachmentRef);
    if (contentError) return err(contentError);

    return ok(
      this.append(
        {
          id: props.id,
          authorId: props.authorId,
          kind: props.kind,
          body: props.body,
          sentAt: props.sentAt,
          ...(props.copyId !== undefined && { copyId: props.copyId }),
          ...(props.attachmentRef !== undefined && {
            attachmentRef: props.attachmentRef,
          }),
        },
        props.sentAt,
      ),
    );
  }

  // Append a service-authored system message. There is no member author and no participant check
  // (the service is trusted); only the text body rules apply. This is the ONLY path that creates a
  // `system` message — a member can never author one (see postMessage's kind type). A join/leave
  // `systemEvent` is only meaningful where participants move, so a pair thread rejects it.
  postSystemMessage(
    props: PostSystemMessageProps,
  ): Result<Message, ConversationError> {
    if (
      props.systemEvent !== undefined &&
      this.state.subject.kind !== "circle"
    ) {
      return err(ConversationError.participantsFixed());
    }
    const bodyError = Thread.validateTextBody(props.body);
    if (bodyError) return err(bodyError);

    return ok(
      this.append(
        {
          id: props.id,
          authorId: null,
          kind: "system",
          body: props.body,
          sentAt: props.sentAt,
          ...(props.systemEvent !== undefined && {
            systemEvent: props.systemEvent,
          }),
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
      subject: state.subject,
      participants: [...state.participants],
      messages: [...state.messages],
      readReceipts: [...state.readReceipts],
    });
  }

  toState(): ThreadState {
    return {
      id: this.state.id,
      subject: this.state.subject,
      participants: [...this.state.participants],
      messages: [...this.state.messages],
      readReceipts: [...this.state.readReceipts],
    };
  }

  private isParticipant(memberId: MemberId): boolean {
    return this.state.participants.some((p) => p.memberId === memberId);
  }

  // The text rule (text and system messages): a body must be non-empty AFTER trimming
  // (whitespace-only is empty) and at most MAX_MESSAGE_LENGTH characters. The trim is only for the
  // emptiness check — the body itself is stored as-given, never mutated.
  private static validateTextBody(body: string): ConversationError | null {
    if (body.trim().length === 0) return ConversationError.emptyMessage();
    if (body.length > MAX_MESSAGE_LENGTH) {
      return ConversationError.messageTooLong();
    }
    return null;
  }

  // The media rule (image and location messages): an attachmentRef is required (blank counts as
  // missing), and the body is an optional caption — empty is fine — of at most MAX_CAPTION_LENGTH
  // characters, stored as-given.
  private static validateMedia(
    caption: string,
    attachmentRef: string | undefined,
  ): ConversationError | null {
    if (attachmentRef === undefined || attachmentRef.trim().length === 0) {
      return ConversationError.attachmentRequired();
    }
    if (caption.length > MAX_CAPTION_LENGTH) {
      return ConversationError.captionTooLong();
    }
    return null;
  }

  // Shared tail of both post paths: append the validated message and record MessagePosted.
  private append(messageState: MessageState, occurredAt: Date): Message {
    this.state.messages.push(messageState);
    this.record(
      new MessagePosted(
        this.state.id,
        this.state.subject,
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
