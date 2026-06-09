import { err, ok, Result } from "../../shared-kernel";
import { CatalogError } from "./errors";

// Difficulty and shape are small closed descriptive vocabularies mirroring the `puzzles`
// columns; kept as string unions rather than VOs since they carry no behaviour.
export type Difficulty = "easy" | "medium" | "hard" | "expert";
export type Shape = "rectangular" | "panoramic" | "round" | "shaped";

// Physical box dimensions. Plain typed field, validated only loosely (positive extents).
export interface Dimensions {
  readonly width: number;
  readonly height: number;
  readonly unit: "cm" | "in";
}

// PieceCount is the one numeric descriptive field with a real invariant (a puzzle has a
// positive whole number of pieces), so it gets a validating value object.
export class PieceCount {
  private constructor(readonly value: number) {}

  static create(value: number): Result<PieceCount, CatalogError> {
    if (!Number.isInteger(value) || value <= 0) {
      return err(CatalogError.invalidPieceCount(value));
    }
    return ok(new PieceCount(value));
  }
}
