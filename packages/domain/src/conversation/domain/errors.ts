import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Thread operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried in a
// Result interchangeably. Every reason here is decidable from the Thread aggregate's own data
// (its participant set and the proposed message); orchestration failures (e.g. ThreadNotFound)
// live in the application layer.
export type ConversationErrorCode =
  | "NotParticipant"
  | "EmptyMessage"
  | "SystemMessageNotAuthorable"
  | "DmRequiresTwoParticipants";

export class ConversationError extends DomainError {
  override readonly name = "ConversationError";

  private constructor(
    readonly code: ConversationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // Only a member who is a participant of the Thread may post a text/image message.
  static notParticipant(): ConversationError {
    return new ConversationError(
      "NotParticipant",
      "Only a thread participant may post a message",
    );
  }

  // A message body (text, or an image's storage reference) must be non-empty.
  static emptyMessage(): ConversationError {
    return new ConversationError(
      "EmptyMessage",
      "A message body must be non-empty",
    );
  }

  // System messages are service-authored: a member may not author one. They are created only
  // via the explicit system-post path, never by a participant posting `kind: "system"`.
  static systemMessageNotAuthorable(): ConversationError {
    return new ConversationError(
      "SystemMessageNotAuthorable",
      "System messages are service-authored and cannot be posted by a member",
    );
  }

  // A DM thread is a pair: exactly two distinct members. (Group DMs are out of scope.)
  static dmRequiresTwoParticipants(): ConversationError {
    return new ConversationError(
      "DmRequiresTwoParticipants",
      "A DM thread requires exactly two distinct participants",
    );
  }
}
