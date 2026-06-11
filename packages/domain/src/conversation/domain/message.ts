import { MemberId, MessageId } from "./ids";

// The kinds of message a thread carries. `text` and `image` are member-authored; `system` is
// service-authored (no member author). For an `image` message the body is a storage reference
// string (the actual binary lives outside the domain).
export type MessageKind = "text" | "image" | "system";

// A Message is an immutable entity within the Thread aggregate. `authorId` is the posting member
// for text/image messages and null for system messages. Messages are only ever constructed by
// the Thread (which enforces the participant/authoring/non-empty invariants), so there is no
// public validating factory here — the aggregate is the single guardian of those rules.
export interface MessageState {
  readonly id: MessageId;
  readonly authorId: MemberId | null;
  readonly kind: MessageKind;
  readonly body: string;
  readonly sentAt: Date;
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

  // Construct from already-validated state. Crossing into a Message never re-checks invariants;
  // the Thread is responsible for them at append time and on rehydration.
  static fromState(state: MessageState): Message {
    return new Message(state);
  }

  toState(): MessageState {
    return this.state;
  }
}
