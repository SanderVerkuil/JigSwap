import { convexErrorCode } from "@/lib/convex-error-code";

// The admin.proposals message for a failed approval. A suggestion filed before the catalogue's
// text bounds existed (SEC-26) can carry text the definition now refuses (TextTooLong); retrying
// can't fix that, so the admin is told to decline it. A suggestion can also propose a barcode
// another puzzle holds (DuplicateBarcode, SEC-05): the admin is told to decline it or fix the
// other puzzle first. Anything else is the generic failure.
export const approveErrorKey = (
  error: unknown,
): "approveTextTooLong" | "duplicateBarcode" | "actionFailed" => {
  switch (convexErrorCode(error)) {
    case "TextTooLong":
      return "approveTextTooLong";
    case "DuplicateBarcode":
      return "duplicateBarcode";
    default:
      return "actionFailed";
  }
};
