import { DomainError } from "../../shared-kernel";
import { ExchangeId, ThreadId } from "../domain";

// Orchestration-level failures the Thread aggregate cannot express because they depend on the
// world (which threads exist) rather than the Thread's own data. Like ConversationError, the
// `code` is the stable, machine-readable discriminant a transport adapter maps to; the message is
// for logs/tests only.
export type ConversationApplicationErrorCode = "ThreadNotFound";

export class ConversationApplicationError extends DomainError {
  override readonly name = "ConversationApplicationError";

  private constructor(
    readonly code: ConversationApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // No thread exists for the referenced thread or exchange (nothing to post to / mark read).
  static threadNotFound(
    ref: ThreadId | ExchangeId,
  ): ConversationApplicationError {
    return new ConversationApplicationError(
      "ThreadNotFound",
      `No thread found for ${ref}`,
    );
  }
}
