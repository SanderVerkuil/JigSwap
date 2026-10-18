import type {
  ConversationApplicationError,
  ConversationError,
} from "@jigswap/domain";
import { ConvexError } from "convex/values";

// Map a domain/application error to a transport error. The stable `code` is preserved so the
// BFF/UI can branch on it (e.g. NotConnected, ThreadNotFound); the message is human-readable.
export const toConvexError = (
  error: ConversationError | ConversationApplicationError,
): ConvexError<{ code: string; message: string }> =>
  new ConvexError({ code: error.code, message: error.message });

/**
 * The refusal for posting to an existing thread that can't take replies, whatever the reason.
 * Today that means the pair is blocked (either way); it is deliberately generic so it can also
 * cover future states (a deleted partner, a closed thread) without telling them apart.
 */
export const cannotReplyError = (): ConvexError<{
  code: string;
  message: string;
}> =>
  new ConvexError({
    code: "CannotReply",
    message: "You can't reply to this conversation",
  });
