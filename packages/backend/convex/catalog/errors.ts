import type { CatalogApplicationError, CatalogError } from "@jigswap/domain";
import { ConvexError } from "convex/values";

// Map a domain/application error to a transport error. The stable `code` is preserved so the
// BFF/UI can branch on it; the message is human-readable.
export const toConvexError = (
  error: CatalogError | CatalogApplicationError,
): ConvexError<{ code: string; message: string }> =>
  new ConvexError({ code: error.code, message: error.message });
