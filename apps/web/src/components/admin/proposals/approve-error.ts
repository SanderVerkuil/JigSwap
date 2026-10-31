import { convexErrorCode } from "@/lib/convex-error-code";

// The admin.proposals message for a failed approval. A suggestion filed before the catalogue's
// text bounds existed (SEC-26) can carry text the definition now refuses (TextTooLong); retrying
// can't fix that, so the admin is told to decline it. A suggestion can also propose a barcode
// another puzzle holds (DuplicateBarcode, SEC-05): the admin is told to decline it or fix the
// other puzzle first. If the proposer edited the suggestion after the admin chose Approve
// (ChangeProposalChanged), the admin is told to check the changes and approve again. Anything else
// is the generic failure.
export const approveErrorKey = (
  error: unknown,
):
  | "approveTextTooLong"
  | "duplicateBarcode"
  | "changedSinceReview"
  | "actionFailed" => {
  switch (convexErrorCode(error)) {
    case "TextTooLong":
      return "approveTextTooLong";
    case "DuplicateBarcode":
      return "duplicateBarcode";
    case "ChangeProposalChanged":
      return "changedSinceReview";
    default:
      return "actionFailed";
  }
};
