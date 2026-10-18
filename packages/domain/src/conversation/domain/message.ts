import { CopyId, MemberId, MessageId } from "./ids";

// The kinds of message a thread carries. `text`, `image` and `location` are member-authored;
// `system` is service-authored (no member author). `image` and `location` are media kinds: they
// reference their attachment through `attachmentRef` and their body is an optional caption.
export type MessageKind = "text" | "image" | "location" | "system";

// The member-authored media kinds: each requires an attachmentRef; the body is a caption.
export type MediaMessageKind = "image" | "location";

// The structured fact a circle thread's join/leave system message records, so each viewer's
// renderer projects the member through their own identity rules instead of reading a snapshotted
// name. There is deliberately no "removed" kind and no remover: removal and leaving render alike.
export interface SystemEvent {
  readonly kind: "joined" | "left";
  readonly memberId: MemberId;
}

// The stored body of a join/leave system message: a non-empty, render-neutral token (the
// renderer uses `systemEvent`; the body only satisfies the non-empty system-body rule).
export const SYSTEM_EVENT_BODY: Readonly<Record<SystemEvent["kind"], string>> =
  { joined: "member_joined", left: "member_left" };

// A Message is an immutable entity within the Thread aggregate. `authorId` is the posting member
// for text/media messages and null for system messages. Messages are only ever constructed by
// the Thread (which enforces the participant/authoring/non-empty invariants), so there is no
// public validating factory here — the aggregate is the single guardian of those rules.
export interface MessageState {
  readonly id: MessageId;
  readonly authorId: MemberId | null;
  readonly kind: MessageKind;
  readonly body: string;
  readonly sentAt: Date;
  // The copy this message is about, when posted from a copy's "Message" action. Optional:
  // absent for plain messages, system messages, and every pre-existing message.
  readonly copyId?: CopyId;
  // Opaque reference to the message's attachment (the attachment's own storage id). Present on
  // exactly the media kinds; absent on text and system messages.
  readonly attachmentRef?: string;
  // The join/leave fact of a circle thread's system message; absent on every other message.
  readonly systemEvent?: SystemEvent;
}

export class Message {
  private constructor(private readonly state: MessageState) {}

  get id(): MessageId {
    return this.state.id;
  }

  get authorId(): MemberId | null {
    return this.state.authorId;
  }

  get kind(): MessageKind {
    return this.state.kind;
  }

  get body(): string {
    return this.state.body;
  }

  get sentAt(): Date {
    return this.state.sentAt;
  }

  get copyId(): CopyId | undefined {
    return this.state.copyId;
  }

  get attachmentRef(): string | undefined {
    return this.state.attachmentRef;
  }

  get systemEvent(): SystemEvent | undefined {
    return this.state.systemEvent;
  }

  // Construct from already-validated state. Crossing into a Message never re-checks invariants;
  // the Thread is responsible for them at append time and on rehydration.
  static fromState(state: MessageState): Message {
    return new Message(state);
  }

  toState(): MessageState {
    return this.state;
  }
}
