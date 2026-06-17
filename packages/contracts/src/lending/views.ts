// Lending read-model view DTOs. A Loan is an open-ended transfer of POSSESSION of a Copy to a
// borrower while ownership stays with the lender; it closes on return or recall. The gateway's
// `lending.*` reads return these. Ids are opaque strings (the web app re-casts at the edge).

import type { MemberView } from "../identity/member";
import type { ProjectedMember } from "../social/social";

/**
 * One loan — used for a member's currently-borrowed list, their currently-lent-out list, and a
 * Copy's full lending history. Carries both parties so a single shape serves every perspective.
 */
export interface LoanView {
  /** The Loan aggregateId (used to return/recall). */
  loanId: string;
  /** The borrowed Copy's CopyId (ownedPuzzles aggregateId). */
  copyId: string;
  /** The borrowed Copy's `ownedPuzzles` _id, for navigation / matching owned-copy views. */
  copyDocId: string;
  /** Cached puzzle title + piece count of the copy. */
  puzzleTitle: string;
  pieceCount: number;
  status: "open" | "returned" | "recalled";
  /** Epoch millis the loan opened. */
  openedAt: number;
  /** Advisory expected-return epoch millis, if one was given. */
  expectedReturn?: number;
  /** Epoch millis the loan closed (returned/recalled), if it has. */
  closedAt?: number;
  /** The owner who lent the copy out. Null if unresolved. */
  lender: MemberView | null;
  /** The borrower holding the copy. Null if unresolved. */
  borrower: MemberView | null;
}

/**
 * A loan as surfaced on a Copy's public lending history (`lending.copyHistory`). Identical to
 * {@link LoanView} except both parties are privacy-projected ({@link ProjectedMember}) so a hidden
 * member's real identity never crosses the wire — mirroring getCopyInstanceView's loan projection.
 */
export interface ProjectedLoanView extends Omit<
  LoanView,
  "lender" | "borrower"
> {
  lender: ProjectedMember;
  borrower: ProjectedMember;
}
