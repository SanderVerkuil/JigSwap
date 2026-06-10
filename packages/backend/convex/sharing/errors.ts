import type { SharingApplicationError, SharingError } from "@jigswap/domain";
import { ConvexError } from "convex/values";

// Map a Sharing domain/application error to a transport error. The stable `code` is preserved so
// the BFF/UI can branch on it; the message is human-readable.
export const toConvexError = (
  error: SharingError | SharingApplicationError,
): ConvexError<{ code: string; message: string }> =>
  new ConvexError({ code: error.code, message: error.message });
