import { DomainError } from "../../shared-kernel";
import { ApprovalStatus } from "./approval";
import { ProposalStatus } from "./proposal-status";

// A closed set of reasons a Catalog operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried
// in a Result interchangeably.
export type CatalogErrorCode =
  | "EmptyTitle"
  | "InvalidPieceCount"
  | "InvalidBarcode"
  | "IllegalApprovalTransition"
  | "EmptyCategoryName"
  | "IllegalProposalTransition"
  | "EmptyProposal"
  | "ProposalNotPending";

export class CatalogError extends DomainError {
  override readonly name = "CatalogError";

  private constructor(
    readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A puzzle definition must carry a non-blank title.
  static emptyTitle(): CatalogError {
    return new CatalogError(
      "EmptyTitle",
      "A puzzle definition requires a non-empty title",
    );
  }

  // Piece count must be a positive integer.
  static invalidPieceCount(value: number): CatalogError {
    return new CatalogError(
      "InvalidPieceCount",
      `Piece count must be a positive integer, got ${value}`,
    );
  }

  // A barcode (EAN/UPC) failed its format check.
  static invalidBarcode(kind: string, detail: string): CatalogError {
    return new CatalogError("InvalidBarcode", `Invalid ${kind}: ${detail}`);
  }

  // The requested approval move is not allowed from the current status.
  static illegalApprovalTransition(
    from: ApprovalStatus,
    to: ApprovalStatus,
  ): CatalogError {
    return new CatalogError(
      "IllegalApprovalTransition",
      `Cannot transition approval from ${from} to ${to}`,
    );
  }

  // A catalog category needs a non-blank name in every supported locale.
  static emptyCategoryName(): CatalogError {
    return new CatalogError(
      "EmptyCategoryName",
      "A catalog category requires a non-empty name in each locale",
    );
  }

  // The requested proposal move is not allowed from the current status.
  static illegalProposalTransition(
    from: ProposalStatus,
    to: ProposalStatus,
  ): CatalogError {
    return new CatalogError(
      "IllegalProposalTransition",
      `Cannot transition proposal from ${from} to ${to}`,
    );
  }

  // A change proposal must alter at least one field.
  static emptyProposal(): CatalogError {
    return new CatalogError(
      "EmptyProposal",
      "A change proposal requires at least one changed field",
    );
  }

  // Only a pending proposal can be edited in place.
  static proposalNotPending(status: ProposalStatus): CatalogError {
    return new CatalogError(
      "ProposalNotPending",
      `Only a pending proposal can be edited, got ${status}`,
    );
  }
}
