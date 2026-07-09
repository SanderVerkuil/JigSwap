import { DomainError } from "../../shared-kernel";
import {
  ApprovalStatus,
  CatalogCategoryId,
  ChangeProposalId,
  PuzzleDefinitionId,
} from "../domain";

// Orchestration-level failures the aggregates cannot express because they depend on the world
// (other documents' state) rather than an aggregate's own data. Like CatalogError, the `code`
// is the stable, machine-readable discriminant a transport adapter maps to; the message is for
// logs/tests only.
export type CatalogApplicationErrorCode =
  | "DuplicateBarcode"
  | "PuzzleDefinitionNotFound"
  | "CatalogCategoryNotFound"
  | "ChangeProposalNotFound"
  | "OpenProposalAlreadyExists"
  | "DefinitionNotProposable";

export class CatalogApplicationError extends DomainError {
  override readonly name = "CatalogApplicationError";

  private constructor(
    readonly code: CatalogApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // Barcode uniqueness: another definition already carries this EAN/UPC/model number.
  static duplicateBarcode(barcode: string): CatalogApplicationError {
    return new CatalogApplicationError(
      "DuplicateBarcode",
      `A puzzle definition already exists with barcode ${barcode}`,
    );
  }

  // No definition exists for the given id.
  static puzzleDefinitionNotFound(
    id: PuzzleDefinitionId,
  ): CatalogApplicationError {
    return new CatalogApplicationError(
      "PuzzleDefinitionNotFound",
      `Puzzle definition ${id} could not be found`,
    );
  }

  // No catalog category exists for the given id.
  static catalogCategoryNotFound(
    id: CatalogCategoryId,
  ): CatalogApplicationError {
    return new CatalogApplicationError(
      "CatalogCategoryNotFound",
      `Catalog category ${id} could not be found`,
    );
  }

  // No change proposal exists for the given id.
  static changeProposalNotFound(id: ChangeProposalId): CatalogApplicationError {
    return new CatalogApplicationError(
      "ChangeProposalNotFound",
      `Change proposal ${id} could not be found`,
    );
  }

  // One open proposal per (definition, proposer): the member should edit the pending one.
  static openProposalAlreadyExists(
    definitionId: PuzzleDefinitionId,
  ): CatalogApplicationError {
    return new CatalogApplicationError(
      "OpenProposalAlreadyExists",
      `You already have an open proposal for definition ${definitionId}`,
    );
  }

  // Community proposals only target APPROVED (publicly visible) definitions.
  static definitionNotProposable(
    id: PuzzleDefinitionId,
    status: ApprovalStatus,
  ): CatalogApplicationError {
    return new CatalogApplicationError(
      "DefinitionNotProposable",
      `Definition ${id} is ${status}; only approved definitions accept change proposals`,
    );
  }
}
