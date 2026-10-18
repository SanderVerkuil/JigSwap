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
  | "MessageTooLong"
  | "CaptionTooLong"
  | "AttachmentRequired"
  | "AttachmentNotAllowed"
  | "SystemMessageNotAuthorable"
  | "DmRequiresTwoParticipants";

// The maximum accepted text message body length in characters. Exported so transports/UI can
// enforce the same bound client-side.
export const MAX_MESSAGE_LENGTH = 4000;

// The maximum accepted caption length in characters for a media (image/location) message.
export const MAX_CAPTION_LENGTH = 1000;

export class ConversationError extends DomainError {
  override readonly name = "ConversationError";

  private constructor(
    readonly code: ConversationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // Only a member who is a participant of the Thread may post a member-authored message.
  static notParticipant(): ConversationError {
    return new ConversationError(
      "NotParticipant",
      "Only a thread participant may post a message",
    );
  }

  // A text (or system) message body must be non-empty.
  static emptyMessage(): ConversationError {
    return new ConversationError(
      "EmptyMessage",
      "A message body must be non-empty",
    );
  }

  // A text (or system) message body may not exceed MAX_MESSAGE_LENGTH characters.
  static messageTooLong(): ConversationError {
    return new ConversationError(
      "MessageTooLong",
      `A message body must be at most ${MAX_MESSAGE_LENGTH} characters`,
    );
  }

  // A media message's caption may not exceed MAX_CAPTION_LENGTH characters (it may be empty).
  static captionTooLong(): ConversationError {
    return new ConversationError(
      "CaptionTooLong",
      `A caption must be at most ${MAX_CAPTION_LENGTH} characters`,
    );
  }

  // An image or location message must reference its attachment.
  static attachmentRequired(): ConversationError {
    return new ConversationError(
      "AttachmentRequired",
      "An image or location message requires an attachment",
    );
  }

  // A text message carries no attachment.
  static attachmentNotAllowed(): ConversationError {
    return new ConversationError(
      "AttachmentNotAllowed",
      "A text message cannot carry an attachment",
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
