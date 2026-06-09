import { DomainError } from "../../shared-kernel";
import { CatalogCategoryId, PuzzleDefinitionId } from "../domain";

// Orchestration-level failures the aggregates cannot express because they depend on the world
// (other documents' state) rather than an aggregate's own data. Like CatalogError, the `code`
// is the stable, machine-readable discriminant a transport adapter maps to; the message is for
// logs/tests only.
export type CatalogApplicationErrorCode =
  | "DuplicateBarcode"
  | "PuzzleDefinitionNotFound"
  | "CatalogCategoryNotFound";

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
  static puzzleDefinitionNotFound(id: PuzzleDefinitionId): CatalogApplicationError {
    return new CatalogApplicationError(
      "PuzzleDefinitionNotFound",
      `Puzzle definition ${id} could not be found`,
    );
  }

  // No catalog category exists for the given id.
  static catalogCategoryNotFound(id: CatalogCategoryId): CatalogApplicationError {
    return new CatalogApplicationError(
      "CatalogCategoryNotFound",
      `Catalog category ${id} could not be found`,
    );
  }
}
