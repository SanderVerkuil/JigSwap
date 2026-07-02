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
