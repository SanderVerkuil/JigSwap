// The member's data export (insights/exportUserDataPage): the sections the client walks, in order,
// and the page every call returns. Shared so the backend's section validator and the web's
// download loop cannot drift apart.

/**
 * Every section of a member's data export, in download order. Each is a list of rows; a section
 * is read page by page until its `isDone`.
 */
export const EXPORT_SECTIONS = [
  "account",
  "pushDevices",
  "copies",
  "copyPhotos",
  "completions",
  "collections",
  "categories",
  "goals",
  "favorites",
  "puzzleReviews",
  "copyReviews",
  "partnerReviewsGiven",
  "partnerReviewsReceived",
  "puzzleComments",
  "photoComments",
  "exchangesProposed",
  "exchangesReceived",
  "loansLent",
  "loansBorrowed",
  "changeProposals",
  "submittedPuzzles",
  "following",
  "followers",
  "followRequestsSent",
  "followRequestsReceived",
  "blocks",
  "circles",
  "household",
  "threads",
  "messagesSent",
  "attachmentsSent",
  "reportsFiled",
  "emailInvitesSent",
  "inviteLinks",
] as const;

export type ExportSection = (typeof EXPORT_SECTIONS)[number];

/** One exported row: plain JSON, never a raw storage id. */
export type ExportRow = { readonly [field: string]: unknown };

/** One page of one section. Pass `continueCursor` back until `isDone`. */
export interface ExportPageView {
  readonly rows: readonly ExportRow[];
  readonly continueCursor: string;
  readonly isDone: boolean;
}
